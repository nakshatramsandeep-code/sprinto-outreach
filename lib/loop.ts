import { CONFIG } from "./config";
import type { Fields } from "./fields";

// Pure decision logic. CODE decides whether we know enough, not the model.

export type Topic = "saas" | "cert" | "stage";

export type LoopState = {
  fields: Fields;
  tried: Record<Topic, number>; // fetch attempts per topic
  fetchesUsed: number;
  securityPageRead: boolean; // did we actually read a security/trust page?
};

export type Decision =
  | { action: "disqualify"; reason: "already_certified" | "not_b2b_saas" }
  | { action: "fetch"; topic: Topic; why: string }
  | { action: "manual_review"; reason: string }
  | { action: "qualify"; flags: string[]; rank: number };

export function stageKnown(f: Fields, minRoles: number = CONFIG.icp.minOpenRolesForStage): boolean {
  return (
    f.funding_stage.value !== null ||
    (f.open_roles.value !== null && f.open_roles.value >= minRoles) ||
    f.enterprise_signal.value === true
  );
}

export function decide(s: LoopState, opts: { cap?: number; minRoles?: number } = {}): Decision {
  const f = s.fields;
  const cap = opts.cap ?? CONFIG.loop.maxExtraFetches;
  const minRoles = opts.minRoles ?? CONFIG.icp.minOpenRolesForStage;
  const left = cap - s.fetchesUsed;
  const L = CONFIG.loop;

  // Short-circuit 1: already certified ends the assessment.
  if (f.certifications.length > 0) return { action: "disqualify", reason: "already_certified" };

  // Short-circuit 2: not B2B SaaS ends the assessment.
  if (f.is_b2b_saas.value === false) return { action: "disqualify", reason: "not_b2b_saas" };

  // Unknown product type: one try, then hand to a human.
  if (f.is_b2b_saas.value === null) {
    if (left > 0 && s.tried.saas < L.saasTries) return { action: "fetch", topic: "saas", why: "product type unknown" };
    return { action: "manual_review", reason: "product_type_unknown" };
  }

  // Certification: one look at the security/trust page.
  if (!s.securityPageRead && left > 0 && s.tried.cert < L.certTries) {
    return { action: "fetch", topic: "cert", why: "no certification evidence yet, check security/trust page" };
  }

  // Stage: up to two tries.
  if (!stageKnown(f, minRoles) && left > 0 && s.tried.stage < L.stageTries) {
    return { action: "fetch", topic: "stage", why: "stage signal missing (funding, open roles, enterprise tier)" };
  }

  // Enough, or cap reached. Qualify, flag what is still unknown.
  const flags: string[] = [];
  if (!s.securityPageRead) flags.push("cert_unconfirmed");
  if (!stageKnown(f, minRoles)) flags.push("stage_unknown");
  if (left <= 0 && flags.length > 0) flags.push("fetch_cap_reached");

  let rank = 100 - 25 * flags.filter((x) => x !== "fetch_cap_reached").length;
  if ((f.open_roles.value ?? 0) >= minRoles) rank += 10;
  if (f.funding_stage.value) rank += 5;
  if (f.enterprise_signal.value) rank += 5;
  return { action: "qualify", flags, rank: Math.min(100, Math.max(0, rank)) }; // a 0-100 scale never exceeds 100
}

export const newLoopState = (fields: Fields): LoopState => ({
  fields,
  tried: { saas: 0, cert: 0, stage: 0 },
  fetchesUsed: 0,
  securityPageRead: false,
});
