import { route, bad, idOf } from "@/lib/api";
import { queueCandidate } from "@/lib/discover";

export const dynamic = "force-dynamic";

export const POST = route(async (_req, ctx) => {
  const id = await idOf(ctx);
  const companyId = await queueCandidate(id, "owner");
  return companyId ? { ok: true, companyId } : bad("candidate has no verified website or is already queued", 409);
});
