import { suggest, type LearningData, type SentRow, type ContactDecision } from "./learning";
import { DEFAULT_ICP, type IcpConfig } from "./icp";
import { pickContact, type HunterPerson } from "./rank";

// ---------------------------------------------------------------------------------------------
// Feedback-loop simulation. Real outcome data is thin, so this PROVES THE MECHANISM instead: we invent a world
// where we know the truth (what really drives replies, what the owner really prefers), feed the learning engine
// the signals a real owner would produce, apply what it suggests, and MEASURE whether the system got better.
// Just as important: in a world with NO real pattern it must stay quiet (a rule that "learns" from noise is worse
// than no rule). Everything is seeded, so results are reproducible.
// ---------------------------------------------------------------------------------------------

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const KEYS = ["saas", "stage", "enterprise", "trigger", "data"] as const;
type Key = (typeof KEYS)[number];
type Fracs = Record<Key, number>;

// What really drives replies. Enterprise pull and a compliance trigger dominate; the default score weights them only 25 / 25 of 100.
export const SIGNAL_TRUTH: Fracs = { saas: 0, stage: 0, enterprise: 0.5, trigger: 0.4, data: 0.1 };
const NULL_TRUTH: Fracs = { saas: 0, stage: 0, enterprise: 0, trigger: 0, data: 0 };

const replyProb = (truth: Fracs, f: Fracs, noSignal: boolean) => (noSignal ? 0.3 : 0.03 + 0.8 * KEYS.reduce((a, k) => a + truth[k] * f[k], 0));
const randomFracs = (r: () => number): Fracs => ({ saas: r(), stage: r(), enterprise: r(), trigger: r(), data: r() });
const scoreOf = (w: Record<Key, number>, f: Fracs) => KEYS.reduce((a, k) => a + w[k] * f[k], 0);

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

// How well does a weight set rank accounts by their TRUE reply probability? (higher correlation = the score points at the right accounts)
function evaluateWeights(w: Record<Key, number>, truth: Fracs, r: () => number, noSignal: boolean, n = 3000) {
  const scores: number[] = [], probs: number[] = [];
  for (let i = 0; i < n; i++) { const f = randomFracs(r); scores.push(scoreOf(w, f)); probs.push(replyProb(truth, f, noSignal)); }
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const topN = Math.floor(n / 4);
  const mean = probs.reduce((a, b) => a + b, 0) / n;
  const topMean = order.slice(0, topN).reduce((a, [, i]) => a + probs[i], 0) / topN;
  return { corr: pearson(scores, probs), liftTopQuartile: mean ? topMean / mean : 1 };
}

export type WeightsSimResult = {
  seeds: number; emailsPerSeed: number;
  signal: { meanCorrBefore: number; meanCorrAfter: number; meanCorrCeiling: number; gainCaptured: number; meanLiftBefore: number; meanLiftAfter: number; pctSeedsImproved: number; worstChange: number; pctSeedsChanged: number; meanEnterpriseTriggerShift: number };
  nullWorld: { pctSeedsChangedWeights: number; meanCorrChange: number };
};

// The best weights the rule is ALLOWED to reach (it may move each weight at most SIG.driftCap points from the defaults).
// Used as the ceiling: "how much of the achievable improvement did learning capture?"
function cappedOracleWeights(truth: Fracs): Record<Key, number> {
  const def = DEFAULT_ICP.weights, cap = 10;
  const w = Object.fromEntries(KEYS.map((k) => [k, Math.max(0, def[k] - cap)])) as Record<Key, number>;
  let left = 100 - KEYS.reduce((a, k) => a + w[k], 0);
  for (const k of [...KEYS].sort((a, b) => truth[b] - truth[a])) { const add = Math.min(left, def[k] + cap - w[k]); w[k] += add; left -= add; }
  return w;
}

export function simulateWeights(seeds = 40, rounds = 10, perRound = 25): WeightsSimResult {
  const run = (seed: number, noSignal: boolean) => {
    const r = rng(seed * 7919 + (noSignal ? 13 : 1));
    const truth = noSignal ? NULL_TRUTH : SIGNAL_TRUTH;
    let cfg: IcpConfig = { ...DEFAULT_ICP };
    const before = evaluateWeights(DEFAULT_ICP.weights, truth, rng(seed + 99991), noSignal);
    const sent: SentRow[] = [];
    const cooldown: Record<string, number> = {};
    let changed = false;
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < perRound; i++) {
        const f = randomFracs(r);
        const outcome = r() < replyProb(truth, f, noSignal) ? "replied" : "no_reply";
        sent.push({ id: sent.length, score: scoreOf(cfg.weights, f), tier: "B", source: "gemini_search", hook: "buyer", edited: false, outcome, lines: KEYS.map((k) => ({ key: k, got: f[k] * cfg.weights[k], max: cfg.weights[k] })), title: null, origWords: null, finalWords: null, removed: [], added: [] });
      }
      const s = suggest({ sent, contacts: [], maybes: [] }, cfg, cooldown).find((x) => x.kind === "weights");
      if (s?.patch) { cfg = { ...cfg, ...s.patch } as IcpConfig; cooldown.weights = sent.length; changed = true; }
    }
    const after = evaluateWeights(cfg.weights, truth, rng(seed + 99991), noSignal);
    const ceiling = evaluateWeights(cappedOracleWeights(truth), truth, rng(seed + 99991), noSignal);
    return { before, after, ceiling, changed, shift: cfg.weights.enterprise + cfg.weights.trigger - (DEFAULT_ICP.weights.enterprise + DEFAULT_ICP.weights.trigger) };
  };
  const sig = Array.from({ length: seeds }, (_, i) => run(i + 1, false));
  const nul = Array.from({ length: seeds }, (_, i) => run(i + 1, true));
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    seeds, emailsPerSeed: rounds * perRound,
    signal: {
      meanCorrBefore: r3(avg(sig.map((s) => s.before.corr))), meanCorrAfter: r3(avg(sig.map((s) => s.after.corr))), meanCorrCeiling: r3(avg(sig.map((s) => s.ceiling.corr))),
      gainCaptured: r3((avg(sig.map((s) => s.after.corr)) - avg(sig.map((s) => s.before.corr))) / Math.max(1e-9, avg(sig.map((s) => s.ceiling.corr)) - avg(sig.map((s) => s.before.corr)))),
      meanLiftBefore: r3(avg(sig.map((s) => s.before.liftTopQuartile))), meanLiftAfter: r3(avg(sig.map((s) => s.after.liftTopQuartile))),
      pctSeedsImproved: r3(sig.filter((s) => s.after.corr > s.before.corr).length / seeds),
      worstChange: r3(Math.min(...sig.map((s) => s.after.corr - s.before.corr))),
      pctSeedsChanged: r3(sig.filter((s) => s.changed).length / seeds),
      meanEnterpriseTriggerShift: r3(avg(sig.map((s) => s.shift))),
    },
    nullWorld: { pctSeedsChangedWeights: r3(nul.filter((s) => s.changed).length / seeds), meanCorrChange: r3(avg(nul.map((s) => s.after.corr - s.before.corr))) },
  };
}

// ---------------------------------------------------------------------------------------------
// Edits: the writer keeps including a phrase the owner always deletes. After the owner approves banning it, does the edit rate fall?
// ---------------------------------------------------------------------------------------------
const FILLER = ["Teams like yours often", "Most security reviews start", "A quick call could show", "Your engineers would keep", "Evidence collection usually", "Audit prep tends to", "Sprinto keeps controls", "Enterprise buyers ask", "Questionnaires pile up when", "We help SaaS teams"];
const FLAW = "We are thrilled to announce a leading platform.";
const sentencePool = (n: number, r: () => number) => Array.from({ length: n }, (_, i) => `${FILLER[i % FILLER.length]} topic number ${i} and detail ${Math.floor(r() * 1e6)}.`);

export type EditsSimResult = { seeds: number; withFlaw: { editRateBefore: number; editRateAfter: number; pctSeedsLearned: number }; nullWorld: { pctSeedsProposedBan: number } };

export function simulateEdits(seeds = 40, drafts = 20): EditsSimResult {
  const oneSeed = (seed: number, flaw: boolean) => {
    const r = rng(seed * 104729 + (flaw ? 5 : 11));
    const pool = sentencePool(600, r);
    let cfg: IcpConfig = { ...DEFAULT_ICP };
    const writer = (banned: boolean) => ({ hasFlaw: flaw && r() < (banned ? 0.03 : 0.6) });
    const sent: SentRow[] = [];
    for (let i = 0; i < drafts; i++) {
      const d = writer(false);
      // the owner deletes the flaw whenever it appears; otherwise occasionally trims one random (never-repeating) sentence
      const removed = d.hasFlaw ? [FLAW] : r() < 0.15 ? [pool[Math.floor(r() * pool.length)]] : [];
      sent.push({ id: i, score: 70, tier: "B", source: "x", hook: "buyer", edited: removed.length > 0, outcome: null, lines: [], title: null, origWords: removed.length ? 110 : null, finalWords: removed.length ? 100 : null, removed, added: [] });
    }
    const s = suggest({ sent, contacts: [], maybes: [] }, cfg, {}).find((x) => x.kind === "phrases");
    const banned = !!s?.patch;
    if (s?.patch) cfg = { ...cfg, ...s.patch } as IcpConfig;
    const editRate = (b: boolean) => { let e = 0; const n = 1000; for (let i = 0; i < n; i++) if (writer(b).hasFlaw) e++; return e / n; };
    return { banned, before: editRate(false), after: editRate(banned) };
  };
  const a = Array.from({ length: seeds }, (_, i) => oneSeed(i + 1, true));
  const b = Array.from({ length: seeds }, (_, i) => oneSeed(i + 1, false));
  const avg = (x: number[]) => x.reduce((p, c) => p + c, 0) / x.length;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { seeds, withFlaw: { editRateBefore: r3(avg(a.map((x) => x.before))), editRateAfter: r3(avg(a.map((x) => x.after))), pctSeedsLearned: r3(a.filter((x) => x.banned).length / seeds) }, nullWorld: { pctSeedsProposedBan: r3(b.filter((x) => x.banned).length / seeds) } };
}

// ---------------------------------------------------------------------------------------------
// Contacts: the owner consistently prefers "VP Engineering" over "CTO". Does the ranker, after learning that, agree with the owner more often?
// ---------------------------------------------------------------------------------------------
const TITLES = ["CTO", "CEO", "VP Engineering", "Head of Security", "Marketing Manager", "Customer Success Associate", "Founder", "COO", "Sales Director", "Director of Product"];
const person = (title: string, r: () => number): HunterPerson => ({ email: "a@b.co", first_name: "A", last_name: "B", position: title, seniority: /CEO|CTO|COO|VP|Head|Founder/.test(title) ? "executive" : "senior", department: null, confidence: 60 + Math.floor(r() * 35), verified: r() < 0.7 });
const company = (r: () => number) => { const k = 5; const picks = new Set<string>(); picks.add(r() < 0.8 ? "CTO" : "CEO"); picks.add("VP Engineering"); while (picks.size < k) picks.add(TITLES[Math.floor(r() * TITLES.length)]); return [...picks].map((t) => person(t, r)); };
const ownerPick = (people: HunterPerson[]) => people.find((p) => p.position === "VP Engineering")?.position ?? "CTO";
const noisyOwnerPick = (people: HunterPerson[], r: () => number) => people[Math.floor(r() * people.length)].position as string;

export type ContactsSimResult = { seeds: number; preference: { agreementBefore: number; agreementAfter: number; pctSeedsLearned: number }; nullWorld: { pctSeedsProposedKeyword: number } };

export function simulateContacts(seeds = 40, decisions = 24): ContactsSimResult {
  const agreement = (kw: string[], r: () => number, n = 400) => { let ok = 0; for (let i = 0; i < n; i++) { const people = company(r); const top = pickContact(people, true, 0, kw).chosen; if (top?.position === ownerPick(people)) ok++; } return ok / n; };
  const oneSeed = (seed: number, preference: boolean) => {
    const r = rng(seed * 15485863 + (preference ? 3 : 8));
    let cfg: IcpConfig = { ...DEFAULT_ICP };
    const contacts: ContactDecision[] = [];
    for (let i = 0; i < decisions; i++) {
      const people = company(r);
      const sys = pickContact(people, true, 0, cfg.preferredTitleKeywords).chosen?.position as string;
      const owner = preference ? ownerPick(people) : noisyOwnerPick(people, r);
      contacts.push(sys === owner ? { mode: "confirmed", title: owner, reason: null } : { mode: "override", title: owner, reason: "better fit" });
    }
    const s = suggest({ sent: [], contacts, maybes: [] }, cfg, {}).find((x) => x.kind === "titles");
    if (s?.patch) cfg = { ...cfg, ...s.patch } as IcpConfig;
    const before = agreement([], rng(seed + 424242));
    const after = agreement(cfg.preferredTitleKeywords, rng(seed + 424242));
    return { learned: !!s?.patch, before, after };
  };
  const a = Array.from({ length: seeds }, (_, i) => oneSeed(i + 1, true));
  const b = Array.from({ length: seeds }, (_, i) => oneSeed(i + 1, false));
  const avg = (x: number[]) => x.reduce((p, c) => p + c, 0) / x.length;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { seeds, preference: { agreementBefore: r3(avg(a.map((x) => x.before))), agreementAfter: r3(avg(a.map((x) => x.after))), pctSeedsLearned: r3(a.filter((x) => x.learned).length / seeds) }, nullWorld: { pctSeedsProposedKeyword: r3(b.filter((x) => x.learned).length / seeds) } };
}

// ---------------------------------------------------------------------------------------------
// Sample-size guard and no-ratchet: with too little data nothing fires; applying the same suggestion repeatedly cannot drift.
// ---------------------------------------------------------------------------------------------
export type StabilityResult = { tinyDataSuggestions: number; weightsAfter10Rounds: number[]; maxWeightDriftAfterFirstApply: number };

export function simulateStability(): StabilityResult {
  const r = rng(777);
  const tiny: SentRow[] = Array.from({ length: 6 }, (_, i) => ({ id: i, score: 70, tier: "B", source: "x", hook: "b", edited: false, outcome: i < 3 ? "replied" : "no_reply", lines: KEYS.map((k) => ({ key: k, got: (i < 3 ? 0.9 : 0.1) * DEFAULT_ICP.weights[k], max: DEFAULT_ICP.weights[k] })), title: null, origWords: null, finalWords: null, removed: [], added: [] }));
  const tinyN = suggest({ sent: tiny, contacts: [], maybes: [] }, DEFAULT_ICP, {}).length;
  // same strong, unchanging data replayed for many rounds with NO new records: weights may move once, then must stay put
  let cfg: IcpConfig = { ...DEFAULT_ICP };
  const sent: SentRow[] = [];
  for (let i = 0; i < 30; i++) { const f = randomFracs(r); sent.push({ id: i, score: 0, tier: "B", source: "x", hook: "b", edited: false, outcome: r() < replyProb(SIGNAL_TRUTH, f, false) ? "replied" : "no_reply", lines: KEYS.map((k) => ({ key: k, got: f[k] * cfg.weights[k], max: cfg.weights[k] })), title: null, origWords: null, finalWords: null, removed: [], added: [] }); }
  const cooldown: Record<string, number> = {};
  const history: number[][] = [];
  for (let round = 0; round < 10; round++) {
    const s = suggest({ sent, contacts: [], maybes: [] }, cfg, cooldown).find((x) => x.kind === "weights");
    if (s?.patch) { cfg = { ...cfg, ...s.patch } as IcpConfig; cooldown.weights = sent.length; }
    history.push(KEYS.map((k) => cfg.weights[k]));
  }
  const first = history[0], last = history[history.length - 1];
  return { tinyDataSuggestions: tinyN, weightsAfter10Rounds: last, maxWeightDriftAfterFirstApply: Math.max(...first.map((w, i) => Math.abs(w - last[i]))) };
}

// ---------------------------------------------------------------------------------------------
export type LoopGate = { name: string; value: number; threshold: string; pass: boolean };
export type LoopSimReport = { weights: WeightsSimResult; weightsLong: WeightsSimResult; edits: EditsSimResult; contacts: ContactsSimResult; stability: StabilityResult; gates: LoopGate[]; allPass: boolean };

export function runLoopSimulation(seeds = 40): LoopSimReport {
  const weights = simulateWeights(seeds), edits = simulateEdits(seeds), contacts = simulateContacts(seeds), stability = simulateStability();
  const weightsLong = simulateWeights(seeds, 10, 60); // 600 emails: shows learning keeps improving as outcome data accumulates
  const g = (name: string, value: number, threshold: string, pass: boolean): LoopGate => ({ name, value, threshold, pass });
  const gates: LoopGate[] = [
    g("Weights learn @250 emails: share of the ACHIEVABLE improvement captured (ceiling = best weights within the ±10 cap)", weights.signal.gainCaptured, ">= 15%", weights.signal.gainCaptured >= 0.15),
    g("Weights learn @600 emails: share of the achievable improvement captured (more data, more learned)", weightsLong.signal.gainCaptured, ">= 40%", weightsLong.signal.gainCaptured >= 0.4),
    g("Weights learn: share of runs that improved @250", weights.signal.pctSeedsImproved, ">= 80%", weights.signal.pctSeedsImproved >= 0.8),
    g("Weights learn: no run gets worse (worst single change in correlation, both volumes)", Math.min(weights.signal.worstChange, weightsLong.signal.worstChange), ">= -0.01", Math.min(weights.signal.worstChange, weightsLong.signal.worstChange) >= -0.01),
    g("Weights: does NOT change on pure noise @250 (false-change rate)", weights.nullWorld.pctSeedsChangedWeights, "<= 10%", weights.nullWorld.pctSeedsChangedWeights <= 0.1),
    g("Weights: does NOT change on pure noise @600 (false-change rate)", weightsLong.nullWorld.pctSeedsChangedWeights, "<= 10%", weightsLong.nullWorld.pctSeedsChangedWeights <= 0.1),
    g("Edits learn: owner's edit rate falls after the ban (relative drop)", Math.round((1 - edits.withFlaw.editRateAfter / Math.max(edits.withFlaw.editRateBefore, 1e-9)) * 1000) / 1000, ">= 60%", 1 - edits.withFlaw.editRateAfter / Math.max(edits.withFlaw.editRateBefore, 1e-9) >= 0.6),
    g("Edits: does NOT propose a ban from scattered, non-repeating edits", edits.nullWorld.pctSeedsProposedBan, "<= 10%", edits.nullWorld.pctSeedsProposedBan <= 0.1),
    g("Contacts learn: agreement with the owner improves (points)", Math.round((contacts.preference.agreementAfter - contacts.preference.agreementBefore) * 1000) / 1000, ">= +15 pts", contacts.preference.agreementAfter - contacts.preference.agreementBefore >= 0.15),
    g("Contacts: does NOT learn a title preference from random choices", contacts.nullWorld.pctSeedsProposedKeyword, "<= 10%", contacts.nullWorld.pctSeedsProposedKeyword <= 0.1),
    g("Too little data: suggestions fired", stability.tinyDataSuggestions, "= 0", stability.tinyDataSuggestions === 0),
    g("No ratchet: weight drift after the first apply (max points)", stability.maxWeightDriftAfterFirstApply, "<= 0", stability.maxWeightDriftAfterFirstApply <= 0),
  ];
  return { weights, weightsLong, edits, contacts, stability, gates, allPass: gates.every((x) => x.pass) };
}
