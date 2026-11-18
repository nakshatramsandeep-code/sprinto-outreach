import { q } from "./db";
import { CONFIG } from "./config";

// Everything a user can tune on the "ICP & Rules" page. Stored in Neon, versioned, read fresh on every run.
export type IcpConfig = {
  thesis: string;
  allowedStages: string[];
  targetFrameworks: string[];
  excludedCategories: string[];
  competitors: string[];
  minOpenRolesForStage: number;
  fundingRecencyDays: number;
  weights: { saas: number; stage: number; enterprise: number; trigger: number; data: number }; // must total 100
  thresholds: { qualified: number; flagged: number; maybe: number };
  penalties: { certUnverified: number; stageUnknown: number };
  loopFetchCap: number;
  hunter: { monthlyCap: number; autoAcceptScore: number };
  rerunDays: number;
  tokensPerCompany: number;
  tokensPerRun: number; // run pauses and asks (H7) above this
  usdPerMillionTokens: number; // estimate only, used for the cost-per-company metric
  confirmBatchOver: number;
  discoveryDailyCap: number;
  email: { minWords: number; maxWords: number; bannedPhrases: string[] };
  followUpDays: number[];
};

export const STAGES = ["Pre-seed", "Seed", "Series A", "Series B", "Series C", "Series D+"];

export const DEFAULT_ICP: IcpConfig = {
  thesis: CONFIG.icp.description,
  allowedStages: ["Seed", "Series A", "Series B", "Series C"],
  targetFrameworks: ["SOC 2", "ISO 27001", "GDPR", "HIPAA", "PCI DSS"],
  excludedCategories: ["agency/services", "D2C/e-commerce brand", "marketplace with no SaaS product", "hardware-only", "government", "non-profit"],
  competitors: [...CONFIG.icp.competitors],
  minOpenRolesForStage: CONFIG.icp.minOpenRolesForStage,
  fundingRecencyDays: 90,
  weights: { saas: 20, stage: 20, enterprise: 25, trigger: 25, data: 10 },
  thresholds: { qualified: 75, flagged: 60, maybe: 40 },
  penalties: { certUnverified: 10, stageUnknown: 5 },
  loopFetchCap: CONFIG.loop.maxExtraFetches,
  hunter: { monthlyCap: CONFIG.budget.hunterMonthlyLimit, autoAcceptScore: 50 },
  rerunDays: 7,
  tokensPerCompany: CONFIG.budget.maxTokensPerCompany,
  tokensPerRun: 400_000,
  usdPerMillionTokens: 0.5,
  confirmBatchOver: 15,
  discoveryDailyCap: 20,
  email: { minWords: CONFIG.email.minWords, maxWords: CONFIG.email.maxWords, bannedPhrases: [...CONFIG.email.bannedPhrases] },
  followUpDays: [3, 7, 14],
};

// Merge a stored (possibly older) config over the defaults so new fields always exist.
export function withDefaults(stored: Partial<IcpConfig> | null | undefined): IcpConfig {
  const s = stored ?? {};
  return {
    ...DEFAULT_ICP,
    ...s,
    weights: { ...DEFAULT_ICP.weights, ...(s.weights ?? {}) },
    thresholds: { ...DEFAULT_ICP.thresholds, ...(s.thresholds ?? {}) },
    penalties: { ...DEFAULT_ICP.penalties, ...(s.penalties ?? {}) },
    hunter: { ...DEFAULT_ICP.hunter, ...(s.hunter ?? {}) },
    email: { ...DEFAULT_ICP.email, ...(s.email ?? {}) },
  };
}

export function validateIcp(c: IcpConfig): string[] {
  const p: string[] = [];
  const total = Object.values(c.weights).reduce((a, b) => a + Number(b), 0);
  if (total !== 100) p.push(`score weights must total 100 (now ${total})`);
  if (Object.values(c.weights).some((w) => w < 0)) p.push("weights cannot be negative");
  const t = c.thresholds;
  if (!(t.qualified > t.flagged && t.flagged > t.maybe && t.maybe >= 0 && t.qualified <= 100)) p.push("thresholds must satisfy qualified > flagged > maybe >= 0");
  if (!(c.loopFetchCap >= 1 && c.loopFetchCap <= 6)) p.push("loop fetch cap must be 1 to 6");
  if (c.hunter.monthlyCap < 0 || c.hunter.monthlyCap > 1000) p.push("Hunter monthly cap out of range");
  if (c.email.minWords >= c.email.maxWords) p.push("email min words must be below max words");
  if (c.rerunDays < 0) p.push("re-run window cannot be negative");
  if (c.tokensPerCompany < 5000) p.push("per-company token ceiling is too low to work");
  if (!c.allowedStages.length) p.push("pick at least one funding stage");
  return p;
}

export async function getIcp(): Promise<{ config: IcpConfig; version: number }> {
  const rows = await q<{ version: number; config: Partial<IcpConfig> }>("SELECT version, config FROM icp_versions WHERE active ORDER BY version DESC LIMIT 1");
  if (rows[0]) return { config: withDefaults(rows[0].config), version: rows[0].version };
  await q(
    "INSERT INTO icp_versions (version, config, note, active, created_by) VALUES (1,$1,'seed defaults',true,'system') ON CONFLICT (version) DO NOTHING",
    [JSON.stringify(DEFAULT_ICP)],
  );
  return { config: DEFAULT_ICP, version: 1 };
}

export async function saveIcp(config: IcpConfig, note: string, actor: string): Promise<number> {
  const cur = await q<{ v: number | null }>("SELECT MAX(version) AS v FROM icp_versions");
  const next = (cur[0]?.v ?? 0) + 1;
  await q("UPDATE icp_versions SET active=false WHERE active");
  await q("INSERT INTO icp_versions (version, config, note, active, created_by) VALUES ($1,$2,$3,true,$4)", [next, JSON.stringify(config), note.slice(0, 200), actor]);
  return next;
}

export async function activateIcp(version: number): Promise<boolean> {
  const r = await q("SELECT 1 FROM icp_versions WHERE version=$1", [version]);
  if (!r.length) return false;
  await q("UPDATE icp_versions SET active = (version=$1)", [version]);
  return true;
}
