import { checkAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { hunterUsed } from "@/lib/hunter";
import { CONFIG } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const companies = await q(
    `SELECT c.id, c.domain, c.name, c.status, c.reason, c.rank, c.flags, c.loop_fetches, c.tokens, c.updated_at,
            c.discovery->>'quote' AS signal, d.id AS draft_id, d.review_status
     FROM companies c LEFT JOIN drafts d ON d.company_id = c.id
     ORDER BY c.updated_at DESC LIMIT 100`,
  );
  return Response.json({ companies, hunter: { used: await hunterUsed(), limit: CONFIG.budget.hunterMonthlyLimit } });
}
