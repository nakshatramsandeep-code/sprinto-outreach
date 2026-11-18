import { q } from "./db";
import { phrases } from "./diff";
import { getIcp, saveIcp, validateIcp, type IcpConfig } from "./icp";
import { audit, getSetting, setSetting } from "./settings";

// ---------------------------------------------------------------------------------------------
// The feedback loop. Signals you already produce (edits, contact overrides, outcomes, maybe-band
// decisions) become SUGGESTED rule changes with the evidence attached. A suggestion only becomes a
// change when you press Apply, which saves a new ICP version (so it can be rolled back).
// Every rule has a minimum sample size: with too little data it says so instead of guessing.
// ---------------------------------------------------------------------------------------------

export const MIN = { weightsOutcomes: 10, weightsEachSide: 3, tier: 5, source: 5, edits: 3, contacts: 4, maybes: 5, phraseDrafts: 3, cooldown: 5 };

// Which pile of records each suggestion kind learns from (used for the cool-down below).
const COUNT_OF: Record<string, "sent" | "contacts" | "maybes"> = { weights: "sent", tier: "sent", source: "sent", phrases: "sent", length: "sent", autoaccept: "contacts", titles: "contacts", maybe: "maybes" };

export type SentRow = {
  id: number; score: number | null; tier: string | null; source: string | null; hook: string | null; edited: boolean;
  outcome: "replied" | "meeting" | "no_reply" | null; lines: { key: string; got: number; max: number }[];
  title: string | null; origWords: number | null; finalWords: number | null; removed: string[]; added: string[];
};
export type ContactDecision = { mode: "confirmed" | "override"; title: string | null; reason: string | null };
export type MaybeDecision = { score: number; action: "qualify" | "disqualify" };
export type LearningData = { sent: SentRow[]; contacts: ContactDecision[]; maybes: MaybeDecision[] };

export type Suggestion = {
  id: string; kind: string; title: string; why: string; evidence: string[];
  patch: Partial<IcpConfig> | null; // null = an insight, nothing to apply
  confidence: "low" | "medium";
};

const LABEL: Record<string, string> = { saas: "B2B SaaS fit", stage: "Stage fit", enterprise: "Enterprise pull", trigger: "Compliance trigger", data: "Data sensitivity" };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const isPos = (o: SentRow["outcome"]) => o === "replied" || o === "meeting";
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const mk = (kind: string, title: string, why: string, evidence: string[], patch: Suggestion["patch"], confidence: Suggestion["confidence"]): Suggestion =>
  ({ id: `${kind}:${hash(JSON.stringify(patch ?? title))}`, kind, title, why, evidence, patch, confidence });

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (rows: SentRow[]) => (rows.length ? rows.filter((r) => isPos(r.outcome)).length / rows.length : 0);

function group<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
}

// ---- 1. score weights from what actually got replies ----
function weightSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  const withO = d.sent.filter((s) => s.outcome && s.lines?.length);
  const pos = withO.filter((s) => isPos(s.outcome)), neg = withO.filter((s) => s.outcome === "no_reply");
  if (withO.length < MIN.weightsOutcomes || pos.length < MIN.weightsEachSide || neg.length < MIN.weightsEachSide) return null;
  const frac = (rows: SentRow[], key: string) => mean(rows.map((r) => { const l = r.lines.find((x) => x.key === key); return l && l.max ? l.got / l.max : 0; }));
  const keys = Object.keys(cfg.weights) as (keyof IcpConfig["weights"])[];
  const diffs = keys.map((k) => ({ k, d: frac(pos, k) - frac(neg, k), p: frac(pos, k), n: frac(neg, k) }));
  if (Math.max(...diffs.map((x) => Math.abs(x.d))) < 0.15) return null;
  const next = { ...cfg.weights };
  for (const { k, d } of diffs) next[k] = Math.max(0, Math.round(cfg.weights[k] + Math.max(-5, Math.min(5, d * 20))));
  // Keep the total at 100 by taking the excess from the components LEAST linked to replies (or giving the shortfall to the MOST linked).
  let sum = Object.values(next).reduce((a, b) => a + b, 0);
  const byD = [...diffs].sort((a, b) => a.d - b.d).map((x) => x.k);
  for (let guard = 0; sum !== 100 && guard < 400; guard++) {
    if (sum > 100) { const k = byD.filter((x) => next[x] > 0)[guard % Math.max(1, byD.filter((x) => next[x] > 0).length)]; next[k]--; sum--; }
    else { const k = [...byD].reverse()[guard % byD.length]; next[k]++; sum++; }
  }
  if (sum !== 100 || keys.every((k) => next[k] === cfg.weights[k])) return null;
  const top = [...diffs].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2);
  return mk("weights", "Shift score weights toward what gets replies",
    "Accounts that replied scored differently from accounts that did not.",
    [...top.map((t) => `${LABEL[t.k]}: replied accounts averaged ${pct(t.p)} of the maximum vs ${pct(t.n)} for no-reply (${t.d > 0 ? "higher" : "lower"} for repliers)`),
      `Based on ${withO.length} emails with a recorded outcome (${pos.length} positive, ${neg.length} no reply)`,
      `Proposed: ${keys.map((k) => `${LABEL[k]} ${cfg.weights[k]}→${next[k]}`).join(", ")}`],
    { weights: next }, withO.length >= 20 ? "medium" : "low");
}

// ---- 2. is the tier predicting replies? (insight only) ----
function tierInsight(d: LearningData): Suggestion | null {
  const g = group(d.sent.filter((s) => s.outcome), (s) => s.tier);
  const A = g.get("A") ?? [], B = g.get("B") ?? [];
  if (A.length < MIN.tier || B.length < MIN.tier || rate(A) >= rate(B) - 0.1) return null;
  return mk("tier", "Tier A is not replying more than Tier B",
    "The score should rank better accounts higher, and right now it does not.",
    [`Tier A: ${pct(rate(A))} replied (n=${A.length}). Tier B: ${pct(rate(B))} replied (n=${B.length})`, "Review the weights, or check whether the contacts at Tier A accounts are the right people."], null, "low");
}

// ---- 3. which discovery source to queue first ----
function sourceSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  const g = group(d.sent.filter((s) => s.outcome), (s) => s.source);
  const rows = [...g.entries()].filter(([, r]) => r.length >= MIN.source).map(([s, r]) => ({ s, n: r.length, r: rate(r) }));
  if (rows.length < 2) return null;
  const best = [...rows].sort((a, b) => b.r - a.r);
  if (best[0].r - best[best.length - 1].r < 0.15) return null;
  const known = rows.map((x) => x.s);
  const currentOrder = cfg.sourcePriority.filter((s) => known.includes(s));
  const proposedOrder = best.map((x) => x.s);
  if (currentOrder.join() === proposedOrder.join()) return null;
  const rest = cfg.sourcePriority.filter((s) => !known.includes(s));
  return mk("source", "Queue the best-replying source first",
    "Some discovery sources lead to more replies than others.",
    rows.map((x) => `${x.s}: ${pct(x.r)} replied (n=${x.n})`), { sourcePriority: [...proposedOrder, ...rest] }, "low");
}

// ---- 4. phrases you keep deleting ----
function phraseSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  const edited = d.sent.filter((s) => s.edited && s.removed?.length);
  if (edited.length < MIN.phraseDrafts) return null;
  const counts = new Map<string, number>();
  for (const s of edited) for (const p of new Set(s.removed.flatMap((x) => phrases(x)))) counts.set(p, (counts.get(p) ?? 0) + 1);
  const banned = cfg.email.bannedPhrases.map((b) => b.toLowerCase());
  // A phrase counts as already covered if any 3 consecutive words of it sit inside a banned phrase (or the reverse).
  const covered = (p: string) => banned.some((b) => {
    const pw = p.split(" "), bw = b.split(" ");
    const win = (w: string[]) => w.length < 3 ? [w.join(" ")] : Array.from({ length: w.length - 2 }, (_, i) => w.slice(i, i + 3).join(" "));
    return win(pw).some((x) => b.includes(x)) || win(bw).some((x) => p.includes(x));
  });
  // Never ban wording that contains "sprinto": the validator requires the company name in every email.
  let cands = [...counts.entries()].filter(([p, c]) => c >= MIN.phraseDrafts && p.split(" ").some((w) => w.length >= 5) && !p.includes("sprinto") && !covered(p));
  cands.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const picked: [string, number][] = [];
  for (const c of cands) { if (picked.length >= 3) break; if (!picked.some(([p]) => p.includes(c[0]) || c[0].includes(p))) picked.push(c); }
  if (!picked.length) return null;
  return mk("phrases", "Ban phrases you keep deleting",
    "You removed the same wording from several drafts before sending.",
    picked.map(([p, c]) => `"${p}" was deleted in ${c} of ${edited.length} edited drafts`),
    { email: { ...cfg.email, bannedPhrases: [...cfg.email.bannedPhrases, ...picked.map(([p]) => p)] } }, edited.length >= 6 ? "medium" : "low");
}

// ---- 5. you keep making emails shorter ----
function lengthSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  const e = d.sent.filter((s) => s.edited && s.origWords && s.finalWords);
  if (e.length < MIN.edits) return null;
  const ratio = mean(e.map((s) => (s.finalWords as number) / (s.origWords as number)));
  if (ratio > 0.8) return null;
  const target = Math.max(cfg.email.minWords + 10, Math.ceil(mean(e.map((s) => s.finalWords as number)) * 1.1));
  if (target >= cfg.email.maxWords) return null;
  const note = `Keep emails under ${target} words.`;
  return mk("length", "Shorten the emails",
    "Your edits make emails shorter than we write them.",
    [`Edited emails ended at ${pct(ratio)} of the original length on average (n=${e.length})`, `Proposed: max words ${cfg.email.maxWords}→${target} and a style note for the writer`],
    { email: { ...cfg.email, maxWords: target }, emailStyleNotes: cfg.emailStyleNotes.includes(note) ? cfg.emailStyleNotes : [...cfg.emailStyleNotes, note] }, "low");
}

// ---- 6. contact auto-accept bar ----
function autoAcceptSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  if (d.contacts.length < MIN.contacts) return null;
  const over = d.contacts.filter((c) => c.mode === "override");
  const r = over.length / d.contacts.length;
  if (r < 0.3 || cfg.hunter.autoAcceptScore >= 90) return null;
  const reasons = group(over.filter((o) => o.reason), (o) => o.reason);
  const topReason = [...reasons.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  return mk("autoaccept", "Raise the contact auto-accept bar",
    "You often replace the contact we pick, so more contacts should wait for your confirmation.",
    [`You overrode ${over.length} of ${d.contacts.length} contacts that needed a human (${pct(r)})`, ...(topReason ? [`Most common reason: ${topReason[0]} (${topReason[1].length})`] : []), `Proposed: auto-accept score ${cfg.hunter.autoAcceptScore}→${Math.min(90, cfg.hunter.autoAcceptScore + 10)}`],
    { hunter: { ...cfg.hunter, autoAcceptScore: Math.min(90, cfg.hunter.autoAcceptScore + 10) } }, "low");
}

// ---- 7. job titles you choose by hand ----
const STOP = new Set(["and", "the", "for", "with", "senior", "junior", "lead"]);
function titleSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  const over = d.contacts.filter((c) => c.mode === "override" && c.title);
  if (over.length < 2) return null;
  const counts = new Map<string, number>();
  for (const c of over) for (const w of new Set((c.title as string).toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 4 && !STOP.has(x)))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const have = cfg.preferredTitleKeywords.map((k) => k.toLowerCase());
  const top = [...counts.entries()].filter(([w, c]) => c >= 2 && !have.includes(w)).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return null;
  return mk("titles", "Prefer the job titles you pick by hand",
    "You keep choosing contacts with the same words in their title.",
    top.map(([w, c]) => `"${w}" appeared in the title of ${c} contacts you chose yourself`),
    { preferredTitleKeywords: [...cfg.preferredTitleKeywords, ...top.map(([w]) => w)] }, "low");
}

// ---- 8. the maybe band ----
function maybeSuggestion(d: LearningData, cfg: IcpConfig): Suggestion | null {
  if (d.maybes.length < MIN.maybes) return null;
  const yes = d.maybes.filter((m) => m.action === "qualify");
  if (yes.length / d.maybes.length < 0.7) return null;
  const lowest = Math.min(...yes.map((m) => m.score));
  const next = Math.max(lowest, cfg.thresholds.maybe + 1);
  if (next >= cfg.thresholds.flagged) return null;
  return mk("maybe", "Lower the Flagged threshold",
    "You qualify most accounts the score calls 'maybe', so the bar is stricter than your judgement.",
    [`You chose "qualify anyway" for ${yes.length} of ${d.maybes.length} maybe-band accounts (${pct(yes.length / d.maybes.length)})`, `Proposed: Flagged from ${cfg.thresholds.flagged}→${next} (the lowest score you accepted)`],
    { thresholds: { ...cfg.thresholds, flagged: next } }, "low");
}

// cooldown[kind] = how many records existed when that kind was last applied. A kind stays quiet until MIN.cooldown NEW
// records arrive, so applying a change can never immediately trigger another one from the same old data (no ratcheting).
export function suggest(d: LearningData, cfg: IcpConfig, cooldown: Record<string, number> = {}): Suggestion[] {
  return [weightSuggestion(d, cfg), tierInsight(d), sourceSuggestion(d, cfg), phraseSuggestion(d, cfg), lengthSuggestion(d, cfg), autoAcceptSuggestion(d, cfg), titleSuggestion(d, cfg), maybeSuggestion(d, cfg)]
    .filter((s): s is Suggestion => s !== null)
    .filter((s) => cooldown[s.kind] === undefined || d[COUNT_OF[s.kind]].length >= cooldown[s.kind] + MIN.cooldown);
}

// ---- dashboard numbers ----
export function stats(d: LearningData) {
  const withO = d.sent.filter((s) => s.outcome);
  const by = (key: (s: SentRow) => string | null) => [...group(withO, key).entries()].map(([k, r]) => ({ key: k, n: r.length, replied: r.filter((x) => isPos(x.outcome)).length, rate: Math.round(rate(r) * 100) })).sort((a, b) => b.n - a.n);
  const edited = d.sent.filter((s) => s.edited);
  const counts = new Map<string, number>();
  for (const s of edited) for (const p of new Set((s.removed ?? []).flatMap((x) => phrases(x)))) counts.set(p, (counts.get(p) ?? 0) + 1);
  const topRemoved = [...counts.entries()].filter(([p, c]) => c >= 2 && p.split(" ").some((w) => w.length >= 5)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, c]) => ({ phrase: p, drafts: c }));
  const ratio = edited.filter((s) => s.origWords && s.finalWords);
  const over = d.contacts.filter((c) => c.mode === "override");
  const reasons = [...group(over.filter((o) => o.reason), (o) => o.reason).entries()].map(([reason, r]) => ({ reason, n: r.length })).sort((a, b) => b.n - a.n);
  return {
    coverage: {
      sent: d.sent.length, outcomes: withO.length, replied: withO.filter((s) => isPos(s.outcome)).length, edited: edited.length,
      contactDecisions: d.contacts.length, overrides: over.length, maybeDecisions: d.maybes.length,
      needs: [
        withO.length < MIN.weightsOutcomes ? `${MIN.weightsOutcomes - withO.length} more emails with a recorded outcome before score weights can be tuned` : null,
        edited.length < MIN.edits ? `${MIN.edits - edited.length} more edited emails before length and phrase patterns show up` : null,
        d.contacts.length < MIN.contacts ? `${MIN.contacts - d.contacts.length} more contact decisions before the auto-accept bar can be tuned` : null,
        d.maybes.length < MIN.maybes ? `${MIN.maybes - d.maybes.length} more maybe-band decisions before the threshold can be tuned` : null,
      ].filter(Boolean) as string[],
    },
    replyBy: { tier: by((s) => s.tier), source: by((s) => s.source), hook: by((s) => s.hook), edited: by((s) => (s.edited ? "edited before sending" : "sent as written")) },
    edits: { topRemoved, avgLengthRatio: ratio.length ? Math.round(mean(ratio.map((s) => (s.finalWords as number) / (s.origWords as number))) * 100) : null },
    contacts: { reasons, overrideRate: d.contacts.length ? Math.round((over.length / d.contacts.length) * 100) : null },
  };
}

// ---- loaders ----
export async function loadLearningData(): Promise<LearningData> {
  const sent = (await q<{
    id: number; score: number | null; tier: string | null; source: string | null; hook_field: string | null; edited: boolean; outcome: SentRow["outcome"];
    lines: SentRow["lines"] | null; title: string | null; edit_diff: { removed?: string[]; added?: string[]; origWords?: number; finalWords?: number } | null;
  }>(
    `SELECT d.id, c.score, c.tier, c.source, d.hook_field, d.edited, d.outcome, c.score_breakdown->'lines' AS lines,
            c.contact->'chosen'->>'position' AS title, d.edit_diff
     FROM drafts d JOIN companies c ON c.id = d.company_id WHERE d.kind='first' AND d.review_status='sent'`,
  )).map((r) => ({
    id: r.id, score: r.score, tier: r.tier, source: r.source, hook: r.hook_field, edited: r.edited, outcome: r.outcome, lines: r.lines ?? [], title: r.title,
    origWords: r.edit_diff?.origWords ?? null, finalWords: r.edit_diff?.finalWords ?? null, removed: r.edit_diff?.removed ?? [], added: r.edit_diff?.added ?? [],
  }));
  const contacts = (await q<{ override: string | null; title: string | null; reason: string | null }>(
    "SELECT contact->>'override' AS override, contact->'chosen'->>'position' AS title, contact->>'override_reason' AS reason FROM companies WHERE contact->>'decided_by_human'='true'",
  )).map((r) => ({ mode: (r.override === "true" ? "override" : "confirmed") as ContactDecision["mode"], title: r.title, reason: r.reason }));
  const maybes = (await q<{ score: number; action: string }>(
    `SELECT (data->>'score')::int AS score, resolution->>'action' AS action FROM checkpoints
     WHERE kind='qualification' AND status='resolved' AND data ? 'score' AND resolution->>'action' IN ('qualify','disqualify')`,
  )).map((r) => ({ score: r.score, action: r.action as MaybeDecision["action"] }));
  return { sent, contacts, maybes };
}

export async function getLearning() {
  const { config, version } = await getIcp();
  const data = await loadLearningData();
  const dismissed = await getSetting<string[]>("dismissed_suggestions", []);
  const all = suggest(data, config, await getSetting<Record<string, number>>("suggestion_cooldown", {}));
  return { version, stats: stats(data), suggestions: all.filter((s) => !dismissed.includes(s.id)), dismissedCount: all.length - all.filter((s) => !dismissed.includes(s.id)).length };
}

// Apply = save a NEW ICP version (so it is reversible) and log who approved it. The server recomputes the suggestion; the client's copy is never trusted.
export async function applySuggestion(id: string): Promise<{ version: number } | { error: string }> {
  const { config } = await getIcp();
  const data = await loadLearningData();
  const cooldown = await getSetting<Record<string, number>>("suggestion_cooldown", {});
  const s = suggest(data, config, cooldown).find((x) => x.id === id);
  if (!s) return { error: "that suggestion no longer applies (the data changed)" };
  if (!s.patch) return { error: "this one is an insight, there is nothing to apply" };
  const next = { ...config, ...s.patch } as IcpConfig;
  const problems = validateIcp(next);
  if (problems.length) return { error: problems.join("; ") };
  const version = await saveIcp(next, `from suggestion: ${s.title}`, "owner");
  await setSetting("suggestion_cooldown", { ...cooldown, [s.kind]: data[COUNT_OF[s.kind]].length });
  await audit("owner", "apply suggestion", { suggestion: s.id, title: s.title, version });
  return { version };
}

export async function dismissSuggestion(id: string) {
  const cur = await getSetting<string[]>("dismissed_suggestions", []);
  if (!cur.includes(id)) await setSetting("dismissed_suggestions", [...cur, id]);
  await audit("owner", "dismiss suggestion", { suggestion: id });
}
