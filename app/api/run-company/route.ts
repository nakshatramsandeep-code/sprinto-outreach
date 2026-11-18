import { route, bad, readJson } from "@/lib/api";
import { runCompany } from "@/lib/pipeline";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { id, force } = await readJson<{ id?: number; force?: boolean }>(req);
  if (!Number.isInteger(id)) return bad("id required");
  return (await runCompany(id as number, { force: !!force })) as unknown as Record<string, unknown>;
});
