import { route, bad, readJson } from "@/lib/api";
import { snapshotCase } from "@/lib/evals";

export const dynamic = "force-dynamic";

// Add an account to the golden set (its pages are snapshotted). Labels are filled in by a human afterwards.
export const POST = route(async (req) => {
  const { companyId } = await readJson<{ companyId?: number }>(req);
  if (!Number.isInteger(companyId)) return bad("companyId required");
  const id = await snapshotCase(companyId as number);
  return id ? { ok: true, id } : bad("no saved pages for that account (research it first)", 404);
});
