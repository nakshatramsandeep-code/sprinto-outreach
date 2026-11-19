import { route } from "@/lib/api";
import { qm } from "@/lib/db";
import { computeDue, SENT_QUERY, FOLLOWUP_DRAFTS_QUERY } from "@/lib/followup";
import { ICP_QUERY, parseIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

// One round trip: board cards, counts, email events and the follow-up inputs together.
export const GET = route(async () => {
  const [cards, [qual], [ev], sentOpen, existing, icp] = await qm([
    [`SELECT d.id AS draft_id, d.company_id, d.kind, d.review_status, d.outcome, d.sent_at, d.subject,
             EXTRACT(DAY FROM now() - d.sent_at)::int AS days_since,
             COALESCE(c.name, c.domain) AS company, c.score, c.tier,
             c.contact->'chosen'->>'first_name' AS fn, c.contact->'chosen'->>'last_name' AS ln
      FROM drafts d JOIN companies c ON c.id=d.company_id ORDER BY COALESCE(d.sent_at, d.created_at) DESC LIMIT 300`],
    ["SELECT COUNT(*)::int AS n FROM companies WHERE status IN ('qualified','qualified_flagged')"],
    [`SELECT COUNT(DISTINCT draft_id) FILTER (WHERE type='email.opened')::int AS opened, COUNT(*)::int AS total FROM email_events`],
    SENT_QUERY, FOLLOWUP_DRAFTS_QUERY, ICP_QUERY,
  ]);
  type Card = { kind: string; review_status: string; outcome: string | null };
  const first = (cards as Card[]).filter((c) => c.kind === "first");
  const sent = first.filter((c) => c.review_status === "sent");
  const replied = sent.filter((c) => c.outcome === "replied").length;
  const meetings = sent.filter((c) => c.outcome === "meeting").length;
  const followUps = computeDue(sentOpen as never, existing as never, parseIcp(icp as never).config.followUpDays);
  return {
    cards, followUps,
    metrics: {
      qualified: qual?.n ?? 0, contacted: sent.length,
      openRate: ev?.total ? Math.round(((ev.opened ?? 0) / Math.max(1, sent.length)) * 100) : null,
      replied, meetings, responseRate: sent.length ? Math.round(((replied + meetings) / sent.length) * 100) : 0,
      followUpsDue: followUps.length,
    },
  };
});
