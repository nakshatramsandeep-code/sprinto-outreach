import { route } from "@/lib/api";
import { q } from "@/lib/db";
import { dueFollowUps } from "@/lib/followup";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const cards = await q(
    `SELECT d.id AS draft_id, d.company_id, d.kind, d.review_status, d.outcome, d.sent_at, d.subject,
            EXTRACT(DAY FROM now() - d.sent_at)::int AS days_since,
            COALESCE(c.name, c.domain) AS company, c.score, c.tier,
            c.contact->'chosen'->>'first_name' AS fn, c.contact->'chosen'->>'last_name' AS ln
     FROM drafts d JOIN companies c ON c.id=d.company_id ORDER BY COALESCE(d.sent_at, d.created_at) DESC LIMIT 300`,
  );
  type Card = { kind: string; review_status: string; outcome: string | null };
  const first = (cards as Card[]).filter((c) => c.kind === "first");
  const sent = first.filter((c) => c.review_status === "sent");
  const qualified = (await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM companies WHERE status IN ('qualified','qualified_flagged')"))[0]?.n ?? 0;
  const ev = await q<{ opened: number; delivered: number; total: number }>(
    `SELECT COUNT(DISTINCT draft_id) FILTER (WHERE type='email.opened')::int AS opened,
            COUNT(DISTINCT draft_id) FILTER (WHERE type='email.delivered')::int AS delivered, COUNT(*)::int AS total FROM email_events`,
  );
  const replied = sent.filter((c) => c.outcome === "replied").length;
  const meetings = sent.filter((c) => c.outcome === "meeting").length;
  const followUps = await dueFollowUps();
  return {
    cards,
    followUps,
    metrics: {
      qualified, contacted: sent.length,
      openRate: ev[0]?.total ? Math.round(((ev[0].opened ?? 0) / Math.max(1, sent.length)) * 100) : null,
      replied, meetings, responseRate: sent.length ? Math.round(((replied + meetings) / sent.length) * 100) : 0,
      followUpsDue: followUps.length,
    },
  };
});
