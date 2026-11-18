import { route, bad, readJson } from "@/lib/api";
import { q } from "@/lib/db";
import { getIcp, saveIcp, validateIcp, withDefaults, DEFAULT_ICP, activateIcp, STAGES, type IcpConfig } from "@/lib/icp";
import { audit } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const { config, version } = await getIcp();
  const versions = await q("SELECT version, note, active, created_by, created_at FROM icp_versions ORDER BY version DESC LIMIT 30");
  return { config, version, versions, stages: STAGES };
});

export const POST = route(async (req) => {
  const b = await readJson<{ config?: Partial<IcpConfig>; note?: string; activate?: number; reset?: boolean }>(req);
  if (b.activate) {
    if (!(await activateIcp(b.activate))) return bad("version not found", 404);
    await audit("owner", "activate ICP version", { version: b.activate });
    return { ok: true };
  }
  if (b.reset) {
    const v = await saveIcp(DEFAULT_ICP, "reset to defaults", "owner");
    await audit("owner", "reset ICP to defaults", { version: v });
    return { ok: true, version: v };
  }
  if (!b.config) return bad("config required");
  const config = withDefaults(b.config);
  const problems = validateIcp(config);
  if (problems.length) return bad(problems.join("; "));
  const v = await saveIcp(config, b.note?.trim() || "edited", "owner");
  await audit("owner", "save ICP", { version: v, note: b.note ?? "" });
  return { ok: true, version: v };
});
