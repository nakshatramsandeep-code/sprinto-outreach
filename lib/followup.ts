import { q, qm, logStep } from "./db";
import { getIcp, ICP_QUERY, parseIcp } from "./icp";
import { draftFollowUp } from "./email";
import { Meter } from "./gemini";
import { getProfile, openCheckpoint, audit } from "./settings";

export type DueFollowUp = { company_id: number; company: string; person: string; draft_id: number; sent_at: string; day: number; days_since: number };

type SentRow = { id: number; company_id: number; sent_at: string; name: string | null; domain: string; contact: { chosen?: { first_name: string; last_name: string | null } } | null; days: number };

// Batchable queries (see qm) so the Pipeline page can load this in the same round trip as the rest of its data.
export const SENT_QUERY: [string, unknown[]] = [
  `SELECT d.id, d.company_id, d.sent_at, c.name, c.domain, c.contact->'chosen' AS chosen, EXTRACT(DAY FROM now() - d.sent_at)::int AS days
   FROM drafts d JOIN companies c ON c.id = d.company_id
   WHERE d.kind='first' AND d.review_status='sent' AND d.outcome IS NULL`, [],
];
export const FOLLOWUP_DRAFTS_QUERY: [string, unknown[]] = ["SELECT company_id, kind FROM drafts WHERE kind LIKE 'followup_%'", []];

// Pure: which follow-ups are due (day 3 / 7 / 14 after the first email, no reply, no draft for that day yet).
export function computeDue(sent: (Omit<SentRow, "contact"> & { chosen?: { first_name: string; last_name: string | null } | null })[], existing: { company_id: number; kind: string }[], followUpDays: number[]): DueFollowUp[] {
  // The furthest step already drafted for each company: once day 7 is drafted, day 3 is behind us and must not be offered again.
  const furthest = new Map<number, number>();
  for (const e of existing) { const d = Number(e.kind.replace("followup_", "")); if (Number.isFinite(d)) furthest.set(e.company_id, Math.max(furthest.get(e.company_id) ?? 0, d)); }
  const due: DueFollowUp[] = [];
  for (const s of sent) {
    const days = [...followUpDays].sort((a, b) => a - b).filter((d) => s.days >= d && d > (furthest.get(s.company_id) ?? 0));
    if (!days.length) continue;
    const day = days[days.length - 1]; // the latest step that has come due
    due.push({
      company_id: s.company_id, company: s.name ?? s.domain, day, draft_id: s.id, sent_at: s.sent_at, days_since: s.days,
      person: s.chosen ? `${s.chosen.first_name} ${s.chosen.last_name ?? ""}`.trim() : "",
    });
  }
  return due;
}

export async function dueFollowUps(): Promise<DueFollowUp[]> {
  const [sent, existing, icp] = await qm([SENT_QUERY, FOLLOWUP_DRAFTS_QUERY, ICP_QUERY]);
  return computeDue(sent as never, existing as never, parseIcp(icp as never).config.followUpDays);
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
