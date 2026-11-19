import { route, bad, idOf } from "@/lib/api";
import { queueCandidate } from "@/lib/discover";

export const dynamic = "force-dynamic";

export const POST = route(async (_req, ctx) => {
  const id = await idOf(ctx);
  const res = await queueCandidate(id, "owner");
  return res ? { ok: true, companyId: res.id, created: res.created } : bad("candidate has no verified website or is already queued", 409);
});
