import { route } from "@/lib/api";
import { q } from "@/lib/db";
import { getAutoQueue } from "@/lib/settings";
import { IST_DAY } from "@/lib/api";
import { SOURCE_LABEL } from "@/lib/discover";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const items = await q("SELECT id, name, domain, source, signal, url, stage, published_at, status, company_id, created_at FROM candidates ORDER BY created_at DESC, id DESC LIMIT 300");
  const foundToday = (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM candidates WHERE ${IST_DAY("created_at")}`))[0]?.n ?? 0;
  const queued = (await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM candidates WHERE status='new' AND domain IS NOT NULL"))[0]?.n ?? 0;
  const seen = (await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM candidates WHERE status IN ('queued')"))[0]?.n ?? 0;
  return { items, foundToday, waiting: queued, queuedTotal: seen, autoQueue: await getAutoQueue(), sources: SOURCE_LABEL };
});
