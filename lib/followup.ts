import { q, logStep } from "./db";
import { getIcp } from "./icp";
import { draftFollowUp } from "./email";
import { Meter } from "./gemini";
import { getProfile, openCheckpoint, audit } from "./settings";

export type DueFollowUp = { company_id: number; company: string; person: string; draft_id: number; sent_at: string; day: number; days_since: number };

// Follow-ups are due at day 3 / 7 / 14 after the first email, if nobody has replied and that day has no draft yet.
export async function dueFollowUps(): Promise<DueFollowUp[]> {
  const { config } = await getIcp();
  const sent = await q<{ id: number; company_id: number; sent_at: string; name: string | null; domain: string; contact: { chosen?: { first_name: string; last_name: string | null } } | null; days: number }>(
    `SELECT d.id, d.company_id, d.sent_at, c.name, c.domain, c.contact, EXTRACT(DAY FROM now() - d.sent_at)::int AS days
     FROM drafts d JOIN companies c ON c.id = d.company_id
     WHERE d.kind='first' AND d.review_status='sent' AND d.outcome IS NULL`,
  );
  const existing = await q<{ company_id: number; kind: string }>("SELECT company_id, kind FROM drafts WHERE kind LIKE 'followup_%'");
  const have = new Set(existing.map((e) => `${e.company_id}:${e.kind}`));
  const due: DueFollowUp[] = [];
  for (const s of sent) {
    const days = [...config.followUpDays].sort((a, b) => a - b).filter((d) => s.days >= d && !have.has(`${s.company_id}:followup_${d}`));
    if (!days.length) continue;
    const day = days[days.length - 1]; // the latest step that has come due
    due.push({
      company_id: s.company_id, company: s.name ?? s.domain, day, draft_id: s.id, sent_at: s.sent_at, days_since: s.days,
      person: s.contact?.chosen ? `${s.contact.chosen.first_name} ${s.contact.chosen.last_name ?? ""}`.trim() : "",
    });
  }
  return due;
}

export async function createFollowUp(companyId: number, day: number) {
  const first = (await q<{ id: number; subject: string; body: string }>("SELECT id, subject, body FROM drafts WHERE company_id=$1 AND kind='first' AND review_status='sent'", [companyId]))[0];
  const c = (await q<{ name: string | null; domain: string; contact: { chosen?: { first_name: string } } | null }>("SELECT name, domain, contact FROM companies WHERE id=$1", [companyId]))[0];
  if (!first || !c?.contact?.chosen) throw new Error("no sent first email for this company");
  const { config } = await getIcp();
  const meter = new Meter(config.tokensPerCompany);
  const out = await draftFollowUp({ firstName: c.contact.chosen.first_name, company: c.name ?? c.domain, originalSubject: first.subject, originalBody: first.body, day, profile: await getProfile(), meter });
  const kind = `followup_${day}`;
  const subject = /^re:/i.test(out.subject) ? out.subject : `Re: ${first.subject}`;
  await q(
    `INSERT INTO drafts (company_id, kind, pains, hook_field, subject, body, original_body, validation, review_status)
     VALUES ($1,$2,'[]','followup',$3,$4,$4,'{"ok":true,"problems":[]}','pending')
     ON CONFLICT (company_id, kind) DO UPDATE SET subject=$3, body=$4, original_body=$4, review_status='pending', sent_at=NULL`,
    [companyId, kind, subject, out.body],
  );
  await openCheckpoint(companyId, "send", `follow-up day ${day} ready: approve & send`, { day });
  await logStep(companyId, "followup_draft", { day }, meter.used);
  await audit("owner", "draft follow-up", { company: companyId, day });
}
