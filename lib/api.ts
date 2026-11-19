import { checkAccess } from "./auth";
import { dbStats, type DbStats } from "./db";

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response | Record<string, unknown> | unknown[]>;

// Every route: optional access-key check, JSON in/out, errors become a clean JSON message.
// It also times the request and reports database round trips in a Server-Timing header
// (visible in the browser's network tab, and read by `npm run perf` and the performance tests).
export function route(fn: Handler) {
  return async (req: Request, ctx: Ctx) => {
    const denied = checkAccess(req);
    if (denied) return denied;
    const stats: DbStats = { trips: 0, ms: 0 };
    const t0 = performance.now();
    const withTiming = (res: Response) => {
      res.headers.set("Server-Timing", `db;dur=${stats.ms.toFixed(0)};desc="${stats.trips} trips", total;dur=${(performance.now() - t0).toFixed(0)}`);
      res.headers.set("X-DB-Trips", String(stats.trips));
      return res;
    };
    try {
      const out = await dbStats.run(stats, () => fn(req, ctx));
      return withTiming(out instanceof Response ? out : Response.json(out));
    } catch (e) {
      return withTiming(Response.json({ error: (e as Error).message ?? "error" }, { status: 500 }));
    }
  };
}

export const bad = (error: string, status = 400) => Response.json({ error }, { status });
export const readJson = async <T,>(req: Request): Promise<T> => ((await req.json().catch(() => ({}))) as T);
export const idOf = async (ctx: Ctx) => Number((await ctx.params).id);

// "today" in India time (the team works on IST)
export const IST_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`;
