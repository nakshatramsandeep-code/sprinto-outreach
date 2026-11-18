import { route, IST_DAY } from "@/lib/api";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

const n = async (sql: string) => (await q<{ n: number }>(sql))[0]?.n ?? 0;

export const GET = route(async () => {
  const draftsReady = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE review_status IN ('pending','edited')");
  const sentWeek = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE review_status='sent' AND sent_at > now() - interval '7 days'");
  const repliedWeek = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE review_status='sent' AND sent_at > now() - interval '7 days' AND outcome IN ('replied','meeting')");
  const mins = (await q<{ m: number | null }>("SELECT AVG(duration_ms)/60000.0 AS m FROM companies WHERE duration_ms IS NOT NULL AND researched_at > now() - interval '7 days'"))[0]?.m;
  const needsYou = await n("SELECT COUNT(*)::int AS n FROM checkpoints WHERE status='open'");

  const funnel = {
    found: await n(`SELECT COUNT(*)::int AS n FROM candidates WHERE ${IST_DAY("created_at")}`),
    scraped: await n(`SELECT COUNT(DISTINCT company_id)::int AS n FROM steps WHERE step='scrape' AND ${IST_DAY("created_at")}`),
    qualified: await n(`SELECT COUNT(*)::int AS n FROM companies WHERE status IN ('qualified','qualified_flagged') AND ${IST_DAY("researched_at")}`),
    contact: await n(`SELECT COUNT(DISTINCT company_id)::int AS n FROM steps WHERE step='contact' AND jsonb_typeof(detail->'chosen')='object' AND ${IST_DAY("created_at")}`),
    drafts: await n(`SELECT COUNT(DISTINCT company_id)::int AS n FROM steps WHERE step='draft' AND ${IST_DAY("created_at")}`),
    sent: await n(`SELECT COUNT(*)::int AS n FROM steps WHERE step='send' AND ${IST_DAY("created_at")}`),
  };

  const lastRun = (await q<{ at: string | null }>("SELECT MAX(created_at) AS at FROM steps WHERE step='discovery_run'"))[0]?.at ?? null;
  const activity = await q(
    `SELECT s.id, s.step, s.detail, s.created_at, c.id AS company_id, COALESCE(c.name, c.domain) AS company
     FROM steps s JOIN companies c ON c.id = s.company_id
     WHERE s.step IN ('score','decision','contact','draft','send','scrape_failed')
     ORDER BY s.id DESC LIMIT 12`,
  );
  const waiting = await q(
    `SELECT d.id, d.company_id, d.subject, d.kind, c.name, c.domain, c.score, c.tier,
            c.contact->'chosen'->>'first_name' AS fn, c.contact->'chosen'->>'last_name' AS ln
     FROM drafts d JOIN companies c ON c.id=d.company_id WHERE d.review_status IN ('pending','edited') ORDER BY d.created_at DESC LIMIT 6`,
  );
  return {
    kpis: { draftsReady, sentWeek, replyRate: sentWeek ? Math.round((repliedWeek / sentWeek) * 100) : 0, minutesPerCompany: mins ? Math.round(mins * 10) / 10 : 0, needsYou },
    funnel, lastRun, activity, waiting,
  };
});
