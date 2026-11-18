import { route, bad, readJson } from "@/lib/api";
import { q } from "@/lib/db";
import { expireCheckpoints, openCheckpoint } from "@/lib/settings";
import { hunterUsed } from "@/lib/hunter";
import { getIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await expireCheckpoints();
  const items = await q(
    `SELECT k.id, k.kind, k.reason, k.data, k.created_at, k.company_id, COALESCE(c.name, c.domain, 'System') AS company, c.domain, c.score, c.tier,
            c.fields, c.contact, c.discovery,
            (SELECT d.id FROM drafts d WHERE d.company_id=c.id AND d.kind = CASE WHEN k.data ? 'day' THEN 'followup_' || (k.data->>'day') ELSE 'first' END LIMIT 1) AS draft_id
     FROM checkpoints k LEFT JOIN companies c ON c.id = k.company_id
     WHERE k.status='open' ORDER BY k.created_at DESC LIMIT 200`,
  );
  const draftIds = (items as { draft_id: number | null }[]).map((i) => i.draft_id).filter(Boolean);
  const drafts = draftIds.length ? await q("SELECT id, subject, body, kind FROM drafts WHERE id = ANY($1)", [draftIds]) : [];
  const { config } = await getIcp();
  const used = await hunterUsed();
  const log = await q("SELECT id, actor, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 12");
  return { items, drafts, hunterLeft: Math.max(0, config.hunter.monthlyCap - used), log };
});

// A run that hit its cost ceiling parks itself here (H7) and waits for a human.
export const POST = route(async (req) => {
  const { reason } = await readJson<{ reason?: string }>(req);
  if (!reason) return bad("reason required");
  await openCheckpoint(null, "system", reason.slice(0, 200), {});
  return { ok: true };
});
