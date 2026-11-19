import { route } from "@/lib/api";
import { qm } from "@/lib/db";
import { hunterUsedQuery } from "@/lib/hunter";
import { ICP_QUERY, parseIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [companies, hunter, icp] = await qm([
    [`SELECT c.id, c.domain, c.name, c.status, c.reason, c.score, c.tier, c.source, c.flags, c.loop_fetches, c.tokens, c.duration_ms, c.updated_at,
             c.discovery->>'quote' AS signal, d.id AS draft_id, d.review_status,
             COALESCE(k.open_n, 0)::int AS open_checkpoints
      FROM companies c
      LEFT JOIN drafts d ON d.company_id = c.id AND d.kind='first'
      LEFT JOIN (SELECT company_id, COUNT(*) AS open_n FROM checkpoints WHERE status='open' GROUP BY company_id) k ON k.company_id = c.id
      ORDER BY c.updated_at DESC LIMIT 300`],
    hunterUsedQuery(),
    ICP_QUERY,
  ]);
  const { config } = parseIcp(icp as never);
  return { companies, hunter: { used: hunter[0]?.value ?? 0, limit: config.hunter.monthlyCap } };
});
