import { route, IST_DAY } from "@/lib/api";
import { qm } from "@/lib/db";

export const dynamic = "force-dynamic";

// ONE round trip for the whole dashboard (it used to be ~15 sequential queries).
export const GET = route(async () => {
  const [[k], [last], activity, waiting] = await qm([
    [`SELECT
        (SELECT COUNT(*)::int FROM drafts WHERE review_status IN ('pending','edited')) AS drafts_ready,
        (SELECT COUNT(*)::int FROM drafts WHERE review_status='sent' AND sent_at > now() - interval '7 days') AS sent_week,
        (SELECT COUNT(*)::int FROM drafts WHERE review_status='sent' AND sent_at > now() - interval '7 days' AND outcome IN ('replied','meeting')) AS replied_week,
        (SELECT AVG(duration_ms)/60000.0 FROM companies WHERE duration_ms IS NOT NULL AND researched_at > now() - interval '7 days') AS mins,
        (SELECT COUNT(*)::int FROM checkpoints WHERE status='open') AS needs_you,
        (SELECT COUNT(*)::int FROM candidates WHERE ${IST_DAY("created_at")}) AS found,
        (SELECT COUNT(DISTINCT company_id)::int FROM steps WHERE step='scrape' AND ${IST_DAY("created_at")}) AS scraped,
        (SELECT COUNT(*)::int FROM companies WHERE status IN ('qualified','qualified_flagged') AND ${IST_DAY("researched_at")}) AS qualified,
        (SELECT COUNT(DISTINCT company_id)::int FROM steps WHERE step='contact' AND jsonb_typeof(detail->'chosen')='object' AND ${IST_DAY("created_at")}) AS contact,
        (SELECT COUNT(DISTINCT company_id)::int FROM steps WHERE step='draft' AND ${IST_DAY("created_at")}) AS drafts_today,
        (SELECT COUNT(*)::int FROM steps WHERE step='send' AND ${IST_DAY("created_at")}) AS sent_today`],
    ["SELECT MAX(created_at) AS at FROM steps WHERE step='discovery_run'"],
    [`SELECT s.id, s.step, s.detail, s.created_at, c.id AS company_id, COALESCE(c.name, c.domain) AS company
      FROM steps s JOIN companies c ON c.id = s.company_id
      WHERE s.step IN ('score','decision','contact','draft','send','scrape_failed')
      ORDER BY s.id DESC LIMIT 12`],
    [`SELECT d.id, d.company_id, d.subject, d.kind, c.name, c.domain, c.score, c.tier,
             c.contact->'chosen'->>'first_name' AS fn, c.contact->'chosen'->>'last_name' AS ln
      FROM drafts d JOIN companies c ON c.id=d.company_id WHERE d.review_status IN ('pending','edited') ORDER BY d.created_at DESC LIMIT 6`],
  ]);
  const mins = k.mins as number | null;
  return {
    kpis: {
      draftsReady: k.drafts_ready, sentWeek: k.sent_week,
      replyRate: k.sent_week ? Math.round((k.replied_week / k.sent_week) * 100) : 0,
      minutesPerCompany: mins ? Math.round(mins * 10) / 10 : 0, needsYou: k.needs_you,
    },
    funnel: { found: k.found, scraped: k.scraped, qualified: k.qualified, contact: k.contact, drafts: k.drafts_today, sent: k.sent_today },
    lastRun: last?.at ?? null, activity, waiting,
  };
});
