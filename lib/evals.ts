import { q } from "./db";
import { extractFromText, extractFingerprint } from "./extract";
import { emptyFields, mergeExtraction, type Fields, type RawExtraction } from "./fields";
import { quoteInText } from "./clean";
import { Meter, gemini, parseJson } from "./gemini";
import { MODELS } from "./config";
import { getIcp, type IcpConfig } from "./icp";
import { draftEmail, validateDraft, evidenceMap, emailFingerprint } from "./email";
import { getProfile } from "./settings";
import type { Ranked } from "./rank";

// ---------------------------------------------------------------------------------------------
// The eval harness answers one question: "is the model still getting the facts right?"
// Ground truth = a human-labelled golden set (pages are snapshotted, so a run is reproducible).
// ---------------------------------------------------------------------------------------------

export type Expected = { certified?: boolean; saas?: "yes" | "no" | "unclear"; stage?: string }; // stage "none" = no stage stated
export type Page = { url: string; text: string };
export type EvalCase = { id: number; domain: string; name: string | null; pages: Page[]; expected: Expected; labeled_by: string | null; company_id: number | null };

export const isLabeled = (e: Expected) => e.certified !== undefined || e.saas !== undefined || e.stage !== undefined;

// Release gates: a model or prompt change should not ship below these.
export const GATES = { certifiedRecall: 0.9, certifiedAccuracy: 0.9, saasAccuracy: 0.85, stageAccuracy: 0.7, minCases: 10 };

export type Pred = { certified: boolean; saas: "yes" | "no" | "unclear"; stage: string | null; rawFields: number; rejected: number; tokens: number; ms: number; evidence: { certs: string[]; stageQuote: string | null; saasQuote: string | null } };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, "");

// ---- pure scoring (unit-tested) ----
export function compareCase(e: Expected, p: Pred) {
  const out: { certified?: boolean; saas?: "ok" | "wrong" | "abstain"; stage?: boolean } = {};
  if (e.certified !== undefined) out.certified = p.certified === e.certified;
  if (e.saas !== undefined) out.saas = p.saas === e.saas ? "ok" : p.saas === "unclear" ? "abstain" : "wrong";
  if (e.stage !== undefined) {
    if (e.stage === "none") out.stage = p.stage === null;
    else out.stage = !!p.stage && (norm(p.stage).includes(norm(e.stage)) || norm(e.stage).includes(norm(p.stage)));
  }
  return out;
}

const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);

export type ExtractionMetrics = {
  n: number;
  certified: { n: number; tp: number; fp: number; fn: number; tn: number; accuracy: number | null; precision: number | null; recall: number | null };
  saas: { n: number; correct: number; wrong: number; abstain: number; accuracy: number | null; coverage: number | null };
  stage: { n: number; correct: number; accuracy: number | null };
  rejectedQuotesPct: number | null;
  avgTokens: number;
  avgMs: number;
};

export function computeExtractionMetrics(rows: { expected: Expected; pred: Pred }[]): ExtractionMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0, sOk = 0, sWrong = 0, sAbs = 0, sN = 0, stOk = 0, stN = 0, raw = 0, rej = 0, tok = 0, ms = 0;
  for (const { expected: e, pred: p } of rows) {
    const c = compareCase(e, p);
    if (e.certified !== undefined) { if (e.certified && p.certified) tp++; else if (!e.certified && p.certified) fp++; else if (e.certified && !p.certified) fn++; else tn++; }
    if (c.saas) { sN++; if (c.saas === "ok") sOk++; else if (c.saas === "wrong") sWrong++; else sAbs++; }
    if (c.stage !== undefined) { stN++; if (c.stage) stOk++; }
    raw += p.rawFields; rej += p.rejected; tok += p.tokens; ms += p.ms;
  }
  const certN = tp + fp + fn + tn;
  return {
    n: rows.length,
    certified: { n: certN, tp, fp, fn, tn, accuracy: ratio(tp + tn, certN), precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) },
    saas: { n: sN, correct: sOk, wrong: sWrong, abstain: sAbs, accuracy: ratio(sOk, sOk + sWrong), coverage: ratio(sOk + sWrong, sN) },
    stage: { n: stN, correct: stOk, accuracy: ratio(stOk, stN) },
    rejectedQuotesPct: ratio(rej, raw),
    avgTokens: rows.length ? Math.round(tok / rows.length) : 0,
    avgMs: rows.length ? Math.round(ms / rows.length) : 0,
  };
}

export type Gate = { name: string; value: number | null; threshold: number; pass: boolean | null };
export function checkGates(m: ExtractionMetrics): Gate[] {
  const g = (name: string, value: number | null, threshold: number, enough: boolean): Gate => ({ name, value, threshold, pass: value === null || !enough ? null : value >= threshold });
  return [
    g("Certified: recall (never miss a certified company)", m.certified.recall, GATES.certifiedRecall, m.certified.tp + m.certified.fn >= 3),
    g("Certified: accuracy", m.certified.accuracy, GATES.certifiedAccuracy, m.certified.n >= GATES.minCases),
    g("B2B SaaS: accuracy when it answers", m.saas.accuracy, GATES.saasAccuracy, m.saas.n >= GATES.minCases),
    g("Funding stage: accuracy", m.stage.accuracy, GATES.stageAccuracy, m.stage.n >= GATES.minCases),
  ];
}

// Compare two runs: any drop of 5+ points (or any new missed certified company) is a regression.
export function regressions(prev: ExtractionMetrics | null, cur: ExtractionMetrics): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const drop = (label: string, a: number | null, b: number | null) => { if (a !== null && b !== null && b < a - 0.05) out.push(`${label} fell ${Math.round(a * 100)}% → ${Math.round(b * 100)}%`); };
  drop("Certified accuracy", prev.certified.accuracy, cur.certified.accuracy);
  drop("Certified recall", prev.certified.recall, cur.certified.recall);
  drop("B2B SaaS accuracy", prev.saas.accuracy, cur.saas.accuracy);
  drop("Stage accuracy", prev.stage.accuracy, cur.stage.accuracy);
  if (cur.certified.fn > prev.certified.fn) out.push(`${cur.certified.fn - prev.certified.fn} more certified compan${cur.certified.fn - prev.certified.fn === 1 ? "y" : "ies"} missed`);
  return out;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const rawCount = (r: RawExtraction, text: string) => {
  let raw = 0, rejected = 0;
  for (const k of ["company_name", "is_b2b_saas", "buyer", "funding_stage", "open_roles", "enterprise_signal"] as const) {
    const f = r[k] as { value?: unknown; quote?: string | null } | undefined;
    if (f && f.value !== null && f.value !== undefined) { raw++; if (!quoteInText(f.quote, text)) rejected++; }
  }
  for (const c of r.certifications ?? []) { raw++; if (!quoteInText(c.quote, text)) rejected++; }
  return { raw, rejected };
};

// Run the same extraction the pipeline runs, on a snapshotted case.
export async function predictCase(c: EvalCase, cfg: IcpConfig): Promise<{ pred: Pred; fields: Fields }> {
  const t0 = Date.now();
  const meter = new Meter(cfg.tokensPerCompany);
  let fields = emptyFields(), raw = 0, rejected = 0;
  for (const p of c.pages) {
    const r = await extractFromText(p.text, p.url, meter, cfg.targetFrameworks);
    const rc = rawCount(r, p.text);
    raw += rc.raw; rejected += rc.rejected;
    fields = mergeExtraction(fields, r, p.text, p.url);
  }
  const saas = fields.is_b2b_saas.value;
  return {
    fields,
    pred: {
      certified: fields.certifications.length > 0,
      saas: saas === true ? "yes" : saas === false ? "no" : "unclear",
      stage: fields.funding_stage.value,
      rawFields: raw, rejected, tokens: meter.used, ms: Date.now() - t0,
      evidence: { certs: fields.certifications.map((x) => `${x.name}: "${x.quote}"`), stageQuote: fields.funding_stage.quote, saasQuote: fields.is_b2b_saas.quote },
    },
  };
}

export async function loadCases(labeledOnly = true): Promise<EvalCase[]> {
  const rows = await q<EvalCase>("SELECT id, domain, name, pages, expected, labeled_by, company_id FROM eval_cases ORDER BY id");
  return labeledOnly ? rows.filter((r) => isLabeled(r.expected)) : rows;
}

export async function runExtractionEval(note = ""): Promise<{ runId: number; metrics: ExtractionMetrics; gates: Gate[]; regressions: string[]; failures: unknown[] }> {
  const { config: cfg, version } = await getIcp();
  const cases = await loadCases(true);
  if (!cases.length) throw new Error("no labelled cases yet: label some on the Evals page first");
  const rows = await pool(cases, 4, async (c) => {
    try { return { c, ...(await predictCase(c, cfg)), error: null as string | null }; }
    catch (e) { return { c, pred: null as Pred | null, fields: null as Fields | null, error: (e as Error).message }; }
  });
  const ok = rows.filter((r): r is typeof r & { pred: Pred } => r.pred !== null);
  const metrics = computeExtractionMetrics(ok.map((r) => ({ expected: r.c.expected, pred: r.pred })));
  const prev = (await q<{ metrics: ExtractionMetrics }>("SELECT metrics FROM eval_runs WHERE kind='extraction' ORDER BY id DESC LIMIT 1"))[0]?.metrics ?? null;
  const failures = rows.flatMap((r): Record<string, unknown>[] => {
    if (!r.pred) return [{ domain: r.c.domain, error: r.error }];
    const cmp = compareCase(r.c.expected, r.pred);
    const bad = cmp.certified === false || cmp.saas === "wrong" || cmp.stage === false;
    return bad ? [{ domain: r.c.domain, caseId: r.c.id, expected: r.c.expected, predicted: { certified: r.pred.certified, saas: r.pred.saas, stage: r.pred.stage }, evidence: r.pred.evidence }] : [];
  });
  const results = rows.map((r) => ({ domain: r.c.domain, expected: r.c.expected, predicted: r.pred ? { certified: r.pred.certified, saas: r.pred.saas, stage: r.pred.stage } : null, error: r.error }));
  const run = await q<{ id: number }>(
    "INSERT INTO eval_runs (kind, model, prompt_hash, icp_version, note, metrics, results) VALUES ('extraction',$1,$2,$3,$4,$5,$6) RETURNING id",
    [MODELS.fast(), extractFingerprint(cfg.targetFrameworks), version, note.slice(0, 200), JSON.stringify(metrics), JSON.stringify({ results, failures })],
  );
  return { runId: run[0].id, metrics, gates: checkGates(metrics), regressions: regressions(prev, metrics), failures };
}

// ---------------------------------------------------------------------------------------------
// Email eval: rule checks (hard) + an LLM judge (soft signal, same model family so it can be generous).
// Uses a made-up contact for each case. Nothing here is ever sent.
// ---------------------------------------------------------------------------------------------
export type Judge = { specific_hook: number; role_relevance: number; tone: number; unsupported_claims: string[] };

export type EmailEvalMetrics = {
  n: number; firstTryValidPct: number | null; avgWords: number; avgSpecific: number | null; avgRelevance: number | null; avgTone: number | null; unsupportedPct: number | null; groundedHookPct: number | null;
};

export function computeEmailMetrics(rows: { firstTryOk: boolean; words: number; hookOk: boolean; judge: Judge | null }[]): EmailEvalMetrics {
  const j = rows.filter((r) => r.judge);
  const avg = (f: (x: Judge) => number) => (j.length ? Math.round((j.reduce((a, r) => a + f(r.judge as Judge), 0) / j.length) * 10) / 10 : null);
  return {
    n: rows.length,
    firstTryValidPct: ratio(rows.filter((r) => r.firstTryOk).length, rows.length),
    avgWords: rows.length ? Math.round(rows.reduce((a, r) => a + r.words, 0) / rows.length) : 0,
    groundedHookPct: ratio(rows.filter((r) => r.hookOk).length, rows.length),
    avgSpecific: avg((x) => x.specific_hook), avgRelevance: avg((x) => x.role_relevance), avgTone: avg((x) => x.tone),
    unsupportedPct: j.length ? ratio(j.filter((r) => (r.judge as Judge).unsupported_claims.length > 0).length, j.length) : null,
  };
}

const JUDGE_SYSTEM = `You are a strict reviewer of cold emails. Score only from the EVIDENCE given. Return JSON only.`;

export async function runEmailEval(note = "", limit = 6) {
  const { config: cfg, version } = await getIcp();
  const profile = await getProfile();
  const cases = (await loadCases(true)).filter((c) => c.expected.certified === false && c.expected.saas === "yes").slice(0, limit);
  if (!cases.length) throw new Error("need labelled cases that are not certified and are B2B SaaS");
  const person: Ranked = { email: "eval@example.com", first_name: "Alex", last_name: "Rivera", position: "CTO", seniority: "executive", department: "executive", confidence: 90, verified: true, score: 60, why: ["eval fixture"] };

  const rows = await pool(cases, 3, async (c) => {
    try {
      const { fields } = await predictCase(c, cfg);
      const evidence = evidenceMap(fields, null);
      const meter = new Meter(cfg.tokensPerCompany);
      const d = await draftEmail({ company: c.name ?? c.domain, domain: c.domain, person, evidence, meter, profile, rules: cfg.email, styleNotes: cfg.emailStyleNotes });
      const v = validateDraft(d, person.first_name ?? "", evidence, cfg.email);
      let judge: Judge | null = null;
      try {
        const prompt = `EVIDENCE (the only facts the email may rely on):\n${Object.entries(evidence).map(([k, x]) => `- ${k}: ${x}`).join("\n")}\n\nEMAIL to ${person.position}:\nSubject: ${d.subject}\n${d.body}\n\nScore 1-5 (5 best): specific_hook (is the opening specific to this company, not generic?), role_relevance (does the pain fit a ${person.position}?), tone (plain, human, not salesy). List unsupported_claims: any factual claim in the email NOT supported by the evidence (empty list if none).\nReturn JSON: {"specific_hook":number,"role_relevance":number,"tone":number,"unsupported_claims":string[]}`;
        judge = parseJson<Judge>((await gemini({ model: MODELS.fast(), system: JUDGE_SYSTEM, prompt, json: true, meter })).text);
      } catch { judge = null; }
      return { domain: c.domain, subject: d.subject, body: d.body, firstTryOk: v.ok, problems: v.problems, words: (d.body.match(/\S+/g) ?? []).length, hookOk: !!evidence[d.hook_field], judge, error: null as string | null };
    } catch (e) {
      return { domain: c.domain, subject: "", body: "", firstTryOk: false, problems: [] as string[], words: 0, hookOk: false, judge: null as Judge | null, error: (e as Error).message };
    }
  });
  const metrics = computeEmailMetrics(rows.filter((r) => !r.error));
  const run = await q<{ id: number }>(
    "INSERT INTO eval_runs (kind, model, prompt_hash, icp_version, note, metrics, results) VALUES ('email',$1,$2,$3,$4,$5,$6) RETURNING id",
    [MODELS.pro(), emailFingerprint({ profile, rules: cfg.email, styleNotes: cfg.emailStyleNotes }), version, note.slice(0, 200), JSON.stringify(metrics), JSON.stringify({ results: rows })],
  );
  return { runId: run[0].id, metrics, rows };
}

// ---------------------------------------------------------------------------------------------
// Feedback -> evals: snapshot an account's pages as a golden-set case (labels come from a human).
// ---------------------------------------------------------------------------------------------
export async function snapshotCase(companyId: number, expected: Expected = {}, labeledBy: string | null = null): Promise<number | null> {
  const c = (await q<{ id: number; domain: string; name: string | null }>("SELECT id, domain, name FROM companies WHERE id=$1", [companyId]))[0];
  if (!c) return null;
  const steps = await q<{ step: string; detail: { url?: string } }>("SELECT step, detail FROM steps WHERE company_id=$1 AND step IN ('scrape','loop_fetch','extra_url')", [companyId]);
  const urls = [...new Set(steps.map((s) => s.detail?.url).filter((u): u is string => !!u))];
  if (!urls.length) return null;
  const pages = await q<Page>("SELECT url, text FROM pages WHERE url = ANY($1)", [urls]);
  if (!pages.length) return null;
  const r = await q<{ id: number }>(
    `INSERT INTO eval_cases (domain, company_id, name, pages, expected, labeled_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (domain) DO UPDATE SET pages=$4, expected = CASE WHEN eval_cases.labeled_by='owner' THEN eval_cases.expected ELSE $5 END,
       labeled_by = CASE WHEN eval_cases.labeled_by='owner' THEN 'owner' ELSE $6 END, updated_at=now() RETURNING id`,
    [c.domain, c.id, c.name, JSON.stringify(pages), JSON.stringify(expected), labeledBy],
  );
  return r[0].id;
}

// A human disqualified a company at the Review queue: that decision IS a label, so it joins the golden set.
export async function addEvalFromDecision(companyId: number, reason: string) {
  const r = reason.toLowerCase();
  const expected: Expected = {};
  if (r.includes("certified")) expected.certified = true;
  else if (r.includes("not saas")) expected.saas = "no";
  else return null;
  return snapshotCase(companyId, expected, "owner");
}
