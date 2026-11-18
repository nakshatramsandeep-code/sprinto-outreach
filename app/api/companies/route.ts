import { route } from "@/lib/api";
import { q } from "@/lib/db";
import { hunterUsed } from "@/lib/hunter";
import { getIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const { config } = await getIcp();
  const companies = await q(
    `SELECT c.id, c.domain, c.name, c.status, c.reason, c.score, c.tier, c.source, c.flags, c.loop_fetches, c.tokens, c.duration_ms, c.updated_at,
            c.discovery->>'quote' AS signal, d.id AS draft_id, d.review_status,
            (SELECT COUNT(*)::int FROM checkpoints k WHERE k.company_id=c.id AND k.status='open') AS open_checkpoints
     FROM companies c LEFT JOIN drafts d ON d.company_id = c.id AND d.kind='first'
     ORDER BY c.updated_at DESC LIMIT 300`,
  );
  return { companies, hunter: { used: await hunterUsed(), limit: config.hunter.monthlyCap } };
});
