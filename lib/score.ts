import type { Fields } from "./fields";
import type { IcpConfig } from "./icp";

// Deterministic 0-100 score. Code scores, never the model, so every point can be explained and re-computed.

export type ScoreLine = { key: string; label: string; got: number; max: number; why: string };
export type ScoreResult = { score: number; tier: "A" | "B" | "C" | "D"; lines: ScoreLine[]; penalties: { label: string; pts: number }[] };
export type DiscoveryInfo = { source?: string; quote?: string; stage?: string | null; published_at?: string | null } | null;

const STRONG = /\b(soc ?2|iso ?27001|compliance|grc|security questionnaire|audit)\b/i;
const ENTERPRISE_BUYER = /enterprise|security|compliance|regulated|bank|health|financ|insur|government|fortune/i;
const SENSITIVE = /health|medical|patient|clinic|insur|bank|fintech|payment|financ|payroll|\bhr\b|identity|legal|security|government|education|child/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, "");
export function stageAllowed(stage: string | null | undefined, allowed: string[]): boolean | null {
  if (!stage) return null;
  const s = norm(stage);
  const hit = allowed.some((a) => {
    const n = norm(a);
    if (n === "seriesd+") return /series[d-z]|growth|late/.test(s);
    return s.includes(n);
  });
  return hit;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreCompany(
  input: { fields: Fields; discovery: DiscoveryInfo; flags: string[]; now?: number },
  cfg: IcpConfig,
): ScoreResult {
  const { fields: f, discovery: d, flags } = input;
  const w = cfg.weights;
  const lines: ScoreLine[] = [];
  const add = (key: string, label: string, frac: number, weight: number, why: string) =>
    lines.push({ key, label, got: round1(Math.min(1, Math.max(0, frac)) * weight), max: weight, why });

  // 1. B2B SaaS fit
  let saas = 0.25, saasWhy = "product type not confirmed";
  if (f.is_b2b_saas.value === true) { saas = f.buyer.value ? 1 : 0.7; saasWhy = f.buyer.value ? `B2B SaaS selling to ${f.buyer.value}` : "B2B SaaS, buyer not named"; }
  add("saas", "B2B SaaS fit", saas, w.saas, saasWhy);

  // 2. Stage fit
  const stageText = f.funding_stage.value ?? d?.stage ?? null;
  const allowed = stageAllowed(stageText, cfg.allowedStages);
  let stage = 0.3, stageWhy = "no stage evidence";
  if (allowed === true) { stage = 0.7; stageWhy = `${stageText} is in the target stages${f.funding_stage.value ? "" : " (from news)"}`; }
  else if (allowed === false) { stage = 0.2; stageWhy = `${stageText} is outside the target stages`; }
  if ((f.open_roles.value ?? 0) >= cfg.minOpenRolesForStage) { stage += 0.3; stageWhy += `; ${f.open_roles.value} open roles`; }
  add("stage", "Stage fit", stage, w.stage, stageWhy);

  // 3. Enterprise pull
  let ent = 0, entWhy: string[] = [];
  if (f.enterprise_signal.value === true) { ent += 0.6; entWhy.push("enterprise tier or large customers"); }
  if (f.buyer.value && ENTERPRISE_BUYER.test(f.buyer.value)) { ent += 0.4; entWhy.push("buyers are security, regulated or enterprise teams"); }
  add("enterprise", "Enterprise pull", ent, w.enterprise, entWhy.join("; ") || "no enterprise signal found");

  // 4. Compliance trigger (why now)
  let trig = 0.2, trigWhy = "no specific trigger";
  const quote = d?.quote ?? "";
  const now = input.now ?? Date.now();
  const pub = d?.published_at ? Date.parse(d.published_at) : NaN;
  const recentRaise = d?.source === "funding_news" && !Number.isNaN(pub) && now - pub <= cfg.fundingRecencyDays * 86_400_000;
  if (recentRaise) { trig = 1; trigWhy = "a recent funding round inside the recency window"; }
  if (f.compliance_hiring.value) { const t = STRONG.test(quote) ? 1 : 0.8; if (t > trig) { trig = t; trigWhy = `hiring for ${f.compliance_hiring.quote ?? "compliance/security"}`; } }
  else if (STRONG.test(quote) && trig < 0.8) { trig = 0.8; trigWhy = "public post mentions SOC 2 / compliance work"; }
  add("trigger", "Compliance trigger (why now)", trig, w.trigger, trigWhy);

  // 5. Data sensitivity
  const sens = SENSITIVE.test(`${f.buyer.value ?? ""} ${quote}`);
  add("data", "Data sensitivity", sens ? 1 : 0.3, w.data, sens ? "handles sensitive data or sells into sensitive sectors" : "no sensitive-data signal");

  const penalties: { label: string; pts: number }[] = [];
  if (flags.includes("cert_unconfirmed")) penalties.push({ label: "certification not verified (no security page read)", pts: cfg.penalties.certUnverified });
  if (flags.includes("stage_unknown")) penalties.push({ label: "stage not verified", pts: cfg.penalties.stageUnknown });

  const raw = lines.reduce((a, l) => a + l.got, 0) - penalties.reduce((a, p) => a + p.pts, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const t = cfg.thresholds;
  const tier = score >= t.qualified ? "A" : score >= t.flagged ? "B" : score >= t.maybe ? "C" : "D";
  return { score, tier, lines, penalties };
}

export const TIER_LABEL = { A: "Qualified", B: "Flagged", C: "Maybe", D: "Disqualified" } as const;
