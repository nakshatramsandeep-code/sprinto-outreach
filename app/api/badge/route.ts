import { route } from "@/lib/api";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// The nav only needs ONE number (open Review items). It used to call the whole dashboard endpoint on every page.
export const GET = route(async () => {
  const r = await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM checkpoints WHERE status='open' AND created_at >= now() - interval '7 days'");
  return { needsYou: r[0]?.n ?? 0 };
});
