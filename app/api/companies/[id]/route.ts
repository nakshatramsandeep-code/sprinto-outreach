import { route, bad, idOf } from "@/lib/api";
import { q } from "@/lib/db";
import { getIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  const id = await idOf(ctx);
  if (!Number.isInteger(id)) return bad("bad id");
  const company = (await q("SELECT * FROM companies WHERE id=$1", [id]))[0];
  if (!company) return bad("not found", 404);
  const steps = await q("SELECT id, step, detail, tokens, created_at FROM steps WHERE company_id=$1 ORDER BY id", [id]);
  const drafts = await q("SELECT * FROM drafts WHERE company_id=$1 ORDER BY id", [id]);
  const checkpoints = await q("SELECT id, kind, reason, status, data, created_at FROM checkpoints WHERE company_id=$1 AND status='open' ORDER BY id", [id]);
  const { config, version } = await getIcp();
  return { company, steps, drafts, draft: drafts.find((d) => (d as { kind: string }).kind === "first") ?? null, checkpoints, icp: { version, usdPerMillionTokens: config.usdPerMillionTokens } };
});
