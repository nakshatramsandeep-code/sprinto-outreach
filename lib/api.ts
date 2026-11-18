import { checkAccess } from "./auth";

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response | Record<string, unknown> | unknown[]>;

// Every route: optional access-key check, JSON in/out, errors become a clean JSON message.
export function route(fn: Handler) {
  return async (req: Request, ctx: Ctx) => {
    const denied = checkAccess(req);
    if (denied) return denied;
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      return Response.json({ error: (e as Error).message ?? "error" }, { status: 500 });
    }
  };
}

export const bad = (error: string, status = 400) => Response.json({ error }, { status });
export const readJson = async <T,>(req: Request): Promise<T> => ((await req.json().catch(() => ({}))) as T);
export const idOf = async (ctx: Ctx) => Number((await ctx.params).id);

// "today" in India time (the team works on IST)
export const IST_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`;
