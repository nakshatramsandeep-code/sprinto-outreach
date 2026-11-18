import { route } from "@/lib/api";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const drafts = await q(
    `SELECT d.id, d.company_id, d.kind, d.subject, d.review_status, d.edited, d.created_at, d.sent_at, c.name, c.domain, c.score, c.tier,
            c.contact->'chosen'->>'first_name' AS fn, c.contact->'chosen'->>'last_name' AS ln, c.contact->'chosen'->>'position' AS title
     FROM drafts d JOIN companies c ON c.id = d.company_id ORDER BY d.created_at DESC LIMIT 200`,
  );
  return { drafts };
});
