import { route, bad, readJson } from "@/lib/api";
import { runExtractionEval, runEmailEval } from "@/lib/evals";
import { audit } from "@/lib/settings";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { kind, note } = await readJson<{ kind?: string; note?: string }>(req);
  if (kind === "extraction") { const r = await runExtractionEval(note ?? ""); await audit("owner", "run extraction eval", { run: r.runId }); return r as unknown as Record<string, unknown>; }
  if (kind === "email") { const r = await runEmailEval(note ?? ""); await audit("owner", "run email eval", { run: r.runId }); return r as unknown as Record<string, unknown>; }
  return bad("kind must be extraction or email");
});
