import { route, bad, readJson } from "@/lib/api";
import { runExtractionEval, runEmailEval, loadCases } from "@/lib/evals";
import { runLoopSimulation } from "@/lib/loopsim";
import { q } from "@/lib/db";
import { audit } from "@/lib/settings";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { kind, note } = await readJson<{ kind?: string; note?: string }>(req);
  if (!kind) return bad("kind required");
  if (kind === "loop") {
    // Pure computation (no model calls, no database reads): simulates the feedback loop against a world with a known truth.
    const report = runLoopSimulation(40);
    const run = await q<{ id: number }>("INSERT INTO eval_runs (kind, model, prompt_hash, icp_version, note, metrics, results) VALUES ('loop','simulation','n/a',NULL,$1,$2,'{}') RETURNING id", [(note ?? "").slice(0, 200), JSON.stringify(report)]);
    await audit("owner", "run feedback-loop simulation", { run: run[0].id, allPass: report.allPass });
    return { runId: run[0].id, ...report } as unknown as Record<string, unknown>;
  }
  if ((kind === "extraction" || kind === "email") && (await loadCases(true)).length === 0) return bad("no labelled cases yet: label some on the Evals page first");
  if (kind === "extraction") { const r = await runExtractionEval(note ?? ""); await audit("owner", "run extraction eval", { run: r.runId }); return r as unknown as Record<string, unknown>; }
  if (kind === "email") { const r = await runEmailEval(note ?? ""); await audit("owner", "run email eval", { run: r.runId }); return r as unknown as Record<string, unknown>; }
  return bad("kind must be extraction, email or loop");
});
