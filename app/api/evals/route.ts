import { route } from "@/lib/api";
import { qm } from "@/lib/db";
import { checkGates, GATES, isLabeled, regressions, type ExtractionMetrics, type Expected } from "@/lib/evals";
import { extractFingerprint } from "@/lib/extract";
import { emailFingerprint } from "@/lib/email";
import { ICP_QUERY, parseIcp } from "@/lib/icp";
import { DEFAULT_PROFILE, type SenderProfile } from "@/lib/settings";
import { MODELS } from "@/lib/config";

export const dynamic = "force-dynamic";

// One round trip. The case list used to ship each account's full extracted JSON; now it ships only the three answers the page shows.
export const GET = route(async () => {
  const [cases, runs, details, companies, profileRows, icp] = await qm([
    [`SELECT e.id, e.domain, e.name, e.expected, e.labeled_by, e.company_id, jsonb_array_length(e.pages)::int AS pages,
             CASE WHEN c.fields IS NULL THEN NULL ELSE jsonb_build_object(
               'certified', jsonb_array_length(COALESCE(c.fields->'certifications','[]'::jsonb)) > 0,
               'saas', c.fields->'is_b2b_saas'->'value', 'stage', c.fields->'funding_stage'->>'value') END AS system
      FROM eval_cases e LEFT JOIN companies c ON c.id = e.company_id ORDER BY e.id`],
    ["SELECT id, kind, model, prompt_hash, icp_version, note, metrics, created_at FROM eval_runs ORDER BY id DESC LIMIT 30"],
    [`(SELECT id, kind, results FROM eval_runs WHERE kind='extraction' ORDER BY id DESC LIMIT 1)
      UNION ALL (SELECT id, kind, results FROM eval_runs WHERE kind='email' ORDER BY id DESC LIMIT 1)`],
    ["SELECT id, COALESCE(name, domain) AS name, domain FROM companies WHERE fields IS NOT NULL ORDER BY updated_at DESC LIMIT 200"],
    ["SELECT value FROM settings WHERE key='sender_profile'"],
    ICP_QUERY,
  ]);
  const { config } = parseIcp(icp as never);
  const profile: SenderProfile = profileRows[0]?.value ?? DEFAULT_PROFILE;
  const extraction = runs.filter((r) => r.kind === "extraction");
  const latest = extraction[0] ?? null;
  const emailLatest = runs.find((r) => r.kind === "email") ?? null;
  const detailOf = (id?: number) => details.find((d) => d.id === id)?.results;

  return {
    cases: cases.map((c) => ({ id: c.id, domain: c.domain, name: c.name, expected: c.expected as Expected, labeled_by: c.labeled_by, company_id: c.company_id, pages: c.pages, labeled: isLabeled(c.expected), system: c.system })),
    runs,
    latest: latest && { ...latest, gates: checkGates(latest.metrics as ExtractionMetrics), regressions: regressions((extraction[1]?.metrics as ExtractionMetrics) ?? null, latest.metrics as ExtractionMetrics), failures: detailOf(latest.id)?.failures ?? [] },
    emailLatest: emailLatest && { ...emailLatest, rows: detailOf(emailLatest.id)?.results ?? [] },
    current: { extractHash: extractFingerprint(config.targetFrameworks), emailHash: emailFingerprint({ profile, rules: config.email, styleNotes: config.emailStyleNotes }), fastModel: MODELS.fast(), proModel: MODELS.pro() },
    gates: GATES,
    companies,
  };
});
