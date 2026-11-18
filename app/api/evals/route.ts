import { route } from "@/lib/api";
import { q } from "@/lib/db";
import { checkGates, GATES, isLabeled, regressions, type ExtractionMetrics, type Expected } from "@/lib/evals";
import { extractFingerprint } from "@/lib/extract";
import { emailFingerprint } from "@/lib/email";
import { getIcp } from "@/lib/icp";
import { getProfile } from "@/lib/settings";
import { MODELS } from "@/lib/config";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const { config } = await getIcp();
  const cases = await q<{ id: number; domain: string; name: string | null; expected: Expected; labeled_by: string | null; company_id: number | null; pages: unknown[]; fields: any }>(
    `SELECT e.id, e.domain, e.name, e.expected, e.labeled_by, e.company_id, jsonb_array_length(e.pages)::int AS pages, c.fields
     FROM eval_cases e LEFT JOIN companies c ON c.id = e.company_id ORDER BY e.id`,
  );
  const runs = await q<{ id: number; kind: string; model: string; prompt_hash: string; icp_version: number | null; note: string | null; metrics: any; created_at: string }>(
    "SELECT id, kind, model, prompt_hash, icp_version, note, metrics, created_at FROM eval_runs ORDER BY id DESC LIMIT 30",
  );
  const extraction = runs.filter((r) => r.kind === "extraction");
  const latest = extraction[0] ?? null;
  const detail = latest ? (await q<{ results: { failures?: unknown[] } }>("SELECT results FROM eval_runs WHERE id=$1", [latest.id]))[0]?.results : null;
  const emailLatest = runs.find((r) => r.kind === "email") ?? null;
  const emailDetail = emailLatest ? (await q<{ results: { results?: unknown[] } }>("SELECT results FROM eval_runs WHERE id=$1", [emailLatest.id]))[0]?.results : null;

  return {
    cases: cases.map((c) => ({
      id: c.id, domain: c.domain, name: c.name, expected: c.expected, labeled_by: c.labeled_by, company_id: c.company_id, pages: c.pages, labeled: isLabeled(c.expected),
      system: c.fields ? { certified: (c.fields.certifications ?? []).length > 0, saas: c.fields.is_b2b_saas?.value ?? null, stage: c.fields.funding_stage?.value ?? null } : null,
    })),
    runs,
    latest: latest && { ...latest, gates: checkGates(latest.metrics as ExtractionMetrics), regressions: regressions((extraction[1]?.metrics as ExtractionMetrics) ?? null, latest.metrics as ExtractionMetrics), failures: detail?.failures ?? [] },
    emailLatest: emailLatest && { ...emailLatest, rows: emailDetail?.results ?? [] },
    current: { extractHash: extractFingerprint(config.targetFrameworks), emailHash: emailFingerprint({ profile: await getProfile(), rules: config.email, styleNotes: config.emailStyleNotes }), fastModel: MODELS.fast(), proModel: MODELS.pro() },
    gates: GATES,
    companies: await q("SELECT id, COALESCE(name, domain) AS name, domain FROM companies WHERE fields IS NOT NULL ORDER BY updated_at DESC LIMIT 200"),
  };
});
