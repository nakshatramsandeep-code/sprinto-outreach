import { route, IST_DAY } from "@/lib/api";
import { qm } from "@/lib/db";
import { SOURCE_LABEL } from "@/lib/discover";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [items, [c], setting] = await qm([
    ["SELECT id, name, domain, source, signal, url, stage, published_at, status, company_id, created_at FROM candidates ORDER BY created_at DESC, id DESC LIMIT 300"],
    [`SELECT (SELECT COUNT(*)::int FROM candidates WHERE ${IST_DAY("created_at")}) AS found_today,
             (SELECT COUNT(*)::int FROM candidates WHERE status='new' AND domain IS NOT NULL) AS waiting,
             (SELECT COUNT(*)::int FROM candidates WHERE status='queued') AS queued_total`],
    ["SELECT value FROM settings WHERE key='auto_queue'"],
  ]);
  return { items, foundToday: c.found_today, waiting: c.waiting, queuedTotal: c.queued_total, autoQueue: setting[0] ? setting[0].value : true, sources: SOURCE_LABEL };
});
