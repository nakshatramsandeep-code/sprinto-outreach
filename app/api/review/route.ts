import { route, bad, readJson } from "@/lib/api";
import { qm } from "@/lib/db";
import { expireCheckpoints, openCheckpoint } from "@/lib/settings";
import { hunterUsedQuery } from "@/lib/hunter";
import { ICP_QUERY, parseIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  // The 7-day auto-skip is a write, so it runs alongside the read. The read already hides items older than 7 days,
  // so the list is right either way. Everything the page needs is fetched in ONE round trip (the draft text is joined in).
  const [, [items, hunter, icp, log]] = await Promise.all([
    expireCheckpoints(),
    qm([
      [`SELECT k.id, k.kind, k.reason, k.data, k.created_at, k.company_id, COALESCE(c.name, c.domain, 'System') AS company, c.domain, c.score, c.tier,
               jsonb_build_object('funding_stage', c.fields->'funding_stage', 'buyer', c.fields->'buyer', 'is_b2b_saas', c.fields->'is_b2b_saas',
                                  'open_roles', c.fields->'open_roles', 'certifications', COALESCE(c.fields->'certifications','[]'::jsonb)) AS fields,
               jsonb_build_object('stage', c.discovery->>'stage', 'quote', c.discovery->>'quote') AS discovery,
               dr.id AS draft_id, dr.subject AS draft_subject, dr.body AS draft_body, dr.kind AS draft_kind
        FROM checkpoints k
        LEFT JOIN companies c ON c.id = k.company_id
        LEFT JOIN drafts dr ON dr.company_id = c.id AND dr.kind = CASE WHEN k.data ? 'day' THEN 'followup_' || (k.data->>'day') ELSE 'first' END
        WHERE k.status='open' AND k.created_at >= now() - interval '7 days'
        ORDER BY k.created_at DESC LIMIT 200`],
      hunterUsedQuery(),
      ICP_QUERY,
      // Eval/simulation housekeeping is developer tooling, not a decision about a prospect, so it stays out of this log.
      ["SELECT id, actor, action, detail, created_at FROM audit_log WHERE action !~* '(eval|simulation)' ORDER BY id DESC LIMIT 12"],
    ]),
  ]);
  const drafts = items.filter((i) => i.draft_id).map((i) => ({ id: i.draft_id, subject: i.draft_subject, body: i.draft_body, kind: i.draft_kind }));
  const slim = items.map(({ draft_subject, draft_body, draft_kind, ...rest }) => rest);
  const { config } = parseIcp(icp as never);
  return { items: slim, drafts, hunterLeft: Math.max(0, config.hunter.monthlyCap - (hunter[0]?.value ?? 0)), log };
});

// A run that hit its cost ceiling parks itself here (H7) and waits for a human.
export const POST = route(async (req) => {
  const { reason } = await readJson<{ reason?: string }>(req);
  if (!reason) return bad("reason required");
  await openCheckpoint(null, "system", reason.slice(0, 200), {});
  return { ok: true };
});
