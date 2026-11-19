import { route, bad, idOf } from "@/lib/api";
import { qm } from "@/lib/db";
import { ICP_QUERY, parseIcp } from "@/lib/icp";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  const id = await idOf(ctx);
  if (!Number.isInteger(id)) return bad("bad id");
  const [[company], steps, drafts, checkpoints, icp] = await qm([
    ["SELECT * FROM companies WHERE id=$1", [id]],
    ["SELECT id, step, detail, tokens, created_at FROM steps WHERE company_id=$1 ORDER BY id", [id]],
    ["SELECT * FROM drafts WHERE company_id=$1 ORDER BY id", [id]],
    ["SELECT id, kind, reason, status, data, created_at FROM checkpoints WHERE company_id=$1 AND status='open' ORDER BY id", [id]],
    ICP_QUERY,
  ]);
  if (!company) return bad("not found", 404);
  const { config, version } = parseIcp(icp as never);
  return { company, steps, drafts, draft: drafts.find((d) => d.kind === "first") ?? null, checkpoints, icp: { version, usdPerMillionTokens: config.usdPerMillionTokens } };
});
