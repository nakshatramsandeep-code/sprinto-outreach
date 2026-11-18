import { describe, it, expect } from "vitest";
import { diffEdit, phrases } from "../lib/diff";
import { compareCase, computeExtractionMetrics, checkGates, regressions, computeEmailMetrics, isLabeled, type Pred, type Expected } from "../lib/evals";
import { suggest, stats, MIN, type LearningData, type SentRow } from "../lib/learning";
import { DEFAULT_ICP } from "../lib/icp";
import { scorePerson, pickContact, type HunterPerson } from "../lib/rank";
import { extractFingerprint } from "../lib/extract";
import { emailFingerprint } from "../lib/email";

const pred = (o: Partial<Pred> = {}): Pred => ({ certified: false, saas: "yes", stage: null, rawFields: 4, rejected: 0, tokens: 1000, ms: 2000, evidence: { certs: [], stageQuote: null, saasQuote: null }, ...o });

describe("edit diff", () => {
  it("returns null when only whitespace or case changed", () => {
    expect(diffEdit("Hello there.  Sprinto helps.", "hello there. sprinto helps.")).toBeNull();
  });
  it("captures removed and added sentences and the length change", () => {
    const d = diffEdit("Hi Sam. I hope this email finds you well. Sprinto automates SOC 2.", "Hi Sam. Sprinto automates SOC 2. Open to a quick call?")!;
    expect(d.removed).toEqual(["I hope this email finds you well."]);
    expect(d.added).toEqual(["Open to a quick call?"]);
    expect(d.finalWords).toBeLessThan(d.origWords + 5);
  });
  it("builds 3-5 word phrases for counting deletions", () => {
    const p = phrases("I hope this email finds you well.");
    expect(p).toContain("i hope this");
    expect(p).toContain("hope this email finds");
    expect(p.every((x) => x.split(" ").length >= 3 && x.split(" ").length <= 5)).toBe(true);
  });
});

describe("eval scoring", () => {
  it("compares each labelled field and ignores unlabelled ones", () => {
    const e: Expected = { certified: true, saas: "yes" };
    const c = compareCase(e, pred({ certified: true, saas: "yes" }));
    expect(c.certified).toBe(true);
    expect(c.saas).toBe("ok");
    expect(c.stage).toBeUndefined();
  });
  it("treats an 'unclear' answer as abstaining, not wrong", () => {
    expect(compareCase({ saas: "yes" }, pred({ saas: "unclear" })).saas).toBe("abstain");
    expect(compareCase({ saas: "yes" }, pred({ saas: "no" })).saas).toBe("wrong");
  });
  it("stage 'none' means the pages state no stage; otherwise names must overlap", () => {
    expect(compareCase({ stage: "none" }, pred({ stage: null })).stage).toBe(true);
    expect(compareCase({ stage: "none" }, pred({ stage: "Series A" })).stage).toBe(false);
    expect(compareCase({ stage: "Series B" }, pred({ stage: "series-b round" })).stage).toBe(true);
    expect(compareCase({ stage: "Series B" }, pred({ stage: null })).stage).toBe(false);
  });
  it("computes precision/recall, SaaS coverage, and rejected-quote rate", () => {
    const rows = [
      { expected: { certified: true, saas: "yes" } as Expected, pred: pred({ certified: true }) },
      { expected: { certified: true, saas: "yes" } as Expected, pred: pred({ certified: false }) }, // missed a certified company
      { expected: { certified: false, saas: "no" } as Expected, pred: pred({ certified: true, saas: "no", rejected: 2, rawFields: 4 }) }, // false positive
      { expected: { certified: false, saas: "yes" } as Expected, pred: pred({ certified: false, saas: "unclear" }) },
    ];
    const m = computeExtractionMetrics(rows);
    expect(m.certified).toMatchObject({ tp: 1, fn: 1, fp: 1, tn: 1 });
    expect(m.certified.recall).toBe(0.5);
    expect(m.certified.precision).toBe(0.5);
    expect(m.saas).toMatchObject({ correct: 3, wrong: 0, abstain: 1 });
    expect(m.saas.coverage).toBe(0.75);
    expect(m.rejectedQuotesPct).toBe(0.125);
  });
});

describe("release gates and regressions", () => {
  const good = computeExtractionMetrics(Array.from({ length: 12 }, (_, i) => ({ expected: { certified: i % 3 === 0, saas: "yes" } as Expected, pred: pred({ certified: i % 3 === 0 }) })));
  it("passes when accuracy is high and there are enough cases", () => {
    const g = checkGates(good);
    expect(g.find((x) => x.name.startsWith("Certified: recall"))!.pass).toBe(true);
    expect(g.find((x) => x.name.startsWith("Certified: accuracy"))!.pass).toBe(true);
  });
  it("says 'not enough labels' instead of passing or failing on tiny samples", () => {
    const tiny = computeExtractionMetrics([{ expected: { certified: true }, pred: pred({ certified: true }) }]);
    expect(checkGates(tiny).every((g) => g.pass === null)).toBe(true);
  });
  it("flags a drop of 5+ points and any newly missed certified company", () => {
    const worse = computeExtractionMetrics(Array.from({ length: 12 }, (_, i) => ({ expected: { certified: i % 3 === 0, saas: "yes" } as Expected, pred: pred({ certified: false }) })));
    const r = regressions(good, worse);
    expect(r.join(" ")).toMatch(/Certified recall fell/);
    expect(r.join(" ")).toMatch(/missed/);
    expect(regressions(null, good)).toEqual([]);
  });
  it("isLabeled needs at least one label", () => {
    expect(isLabeled({})).toBe(false);
    expect(isLabeled({ certified: false })).toBe(true);
  });
});

describe("email eval metrics", () => {
  it("aggregates rule checks and judge scores, and counts unsupported claims", () => {
    const m = computeEmailMetrics([
      { firstTryOk: true, words: 90, hookOk: true, judge: { specific_hook: 5, role_relevance: 4, tone: 4, unsupported_claims: [] } },
      { firstTryOk: false, words: 110, hookOk: true, judge: { specific_hook: 3, role_relevance: 4, tone: 5, unsupported_claims: ["raised $50M"] } },
    ]);
    expect(m.firstTryValidPct).toBe(0.5);
    expect(m.avgWords).toBe(100);
    expect(m.avgSpecific).toBe(4);
    expect(m.unsupportedPct).toBe(0.5);
  });
});

describe("prompt fingerprints (so a wording change is visible in eval history)", () => {
  it("are stable for the same inputs and change when rules change", () => {
    expect(extractFingerprint(["SOC 2"])).toBe(extractFingerprint(["SOC 2"]));
    expect(extractFingerprint(["SOC 2"])).not.toBe(extractFingerprint(["SOC 2", "HIPAA"]));
    const a = emailFingerprint({ styleNotes: [] });
    expect(emailFingerprint({ styleNotes: [] })).toBe(a);
    expect(emailFingerprint({ styleNotes: ["Keep it under 80 words."] })).not.toBe(a);
  });
});

// ---------------- learning rules ----------------
const lines = (f: Partial<Record<"saas" | "stage" | "enterprise" | "trigger" | "data", number>>) =>
  (["saas", "stage", "enterprise", "trigger", "data"] as const).map((k) => ({ key: k, got: (f[k] ?? 0.5) * 10, max: 10 }));
const row = (o: Partial<SentRow>): SentRow => ({ id: 1, score: 70, tier: "B", source: "gemini_search", hook: "buyer", edited: false, outcome: null, lines: lines({}), title: "CTO", origWords: null, finalWords: null, removed: [], added: [], ...o });
const empty: LearningData = { sent: [], contacts: [], maybes: [] };

describe("learning: stays silent without enough data", () => {
  it("gives no suggestions from an empty history", () => {
    expect(suggest(empty, DEFAULT_ICP)).toEqual([]);
  });
  it("gives none from a handful of outcomes", () => {
    const d = { ...empty, sent: [row({ outcome: "replied" }), row({ outcome: "no_reply" })] };
    expect(suggest(d, DEFAULT_ICP)).toEqual([]);
  });
  it("tells you what is missing", () => {
    expect(stats(empty).coverage.needs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("learning: score weights from outcomes", () => {
  it("shifts weight toward the component repliers scored higher on, keeping the total at 100", () => {
    const sent = [
      ...Array.from({ length: 5 }, (_, i) => row({ id: i, outcome: "replied", lines: lines({ enterprise: 0.9, trigger: 0.9 }) })),
      ...Array.from({ length: 6 }, (_, i) => row({ id: 10 + i, outcome: "no_reply", lines: lines({ enterprise: 0.3, trigger: 0.4 }) })),
    ];
    const s = suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "weights")!;
    expect(s).toBeTruthy();
    const w = (s.patch as { weights: typeof DEFAULT_ICP.weights }).weights;
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100);
    expect(w.enterprise).toBeGreaterThan(DEFAULT_ICP.weights.enterprise);
    expect(s.evidence.join(" ")).toMatch(/Enterprise pull|Compliance trigger/);
  });
  it("does nothing when repliers and non-repliers look alike", () => {
    const sent = [...Array.from({ length: 6 }, (_, i) => row({ id: i, outcome: "replied" })), ...Array.from({ length: 6 }, (_, i) => row({ id: 20 + i, outcome: "no_reply" }))];
    expect(suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "weights")).toBeUndefined();
  });
});

describe("learning: tiers and sources", () => {
  it("flags Tier A replying less than Tier B as an insight with nothing to apply", () => {
    const sent = [
      ...Array.from({ length: 5 }, (_, i) => row({ id: i, tier: "A", outcome: "no_reply" })),
      ...Array.from({ length: 5 }, (_, i) => row({ id: 10 + i, tier: "B", outcome: i < 3 ? "replied" : "no_reply" })),
    ];
    const s = suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "tier")!;
    expect(s.patch).toBeNull();
  });
  it("reorders discovery sources by reply rate", () => {
    const sent = [
      ...Array.from({ length: 5 }, (_, i) => row({ id: i, source: "hn_hiring", outcome: "no_reply" })),
      ...Array.from({ length: 5 }, (_, i) => row({ id: 10 + i, source: "funding_news", outcome: i < 3 ? "replied" : "no_reply" })),
    ];
    const s = suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "source")!;
    const order = (s.patch as { sourcePriority: string[] }).sourcePriority;
    expect(order.indexOf("funding_news")).toBeLessThan(order.indexOf("hn_hiring"));
  });
});

describe("learning: what you edit", () => {
  const edited = (id: number, removed: string[], o: number, f: number) => row({ id, edited: true, removed, origWords: o, finalWords: f });
  it("proposes banning a phrase deleted in 3+ drafts, but not one already banned", () => {
    const sent = [1, 2, 3, 4].map((i) => edited(i, ["I hope this email finds you well."], 100, 90));
    const s = suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "phrases");
    // "hope this email finds you well" is already a banned phrase in the defaults, so only new wording may appear
    const sent2 = [1, 2, 3].map((i) => edited(i, ["We are thrilled to announce a leading platform."], 100, 95));
    const s2 = suggest({ ...empty, sent: sent2 }, DEFAULT_ICP).find((x) => x.kind === "phrases")!;
    const banned = (s2.patch as { email: { bannedPhrases: string[] } }).email.bannedPhrases;
    expect(banned.length).toBeGreaterThan(DEFAULT_ICP.email.bannedPhrases.length);
    expect(banned.some((p) => p.includes("thrilled to announce"))).toBe(true);
    expect(s === undefined || !(s.patch as { email: { bannedPhrases: string[] } }).email.bannedPhrases.some((p) => p.includes("hope this email"))).toBe(true);
  });
  it("does not act on a phrase deleted in only 2 drafts", () => {
    const sent = [1, 2].map((i) => edited(i, ["We are thrilled to announce a leading platform."], 100, 95));
    expect(suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "phrases")).toBeUndefined();
  });
  it("proposes a shorter max length and a style note when you keep cutting", () => {
    const sent = [1, 2, 3].map((i) => edited(i, ["Some sentence that is long enough to remove."], 130, 80));
    const s = suggest({ ...empty, sent }, DEFAULT_ICP).find((x) => x.kind === "length")!;
    const p = s.patch as { email: { maxWords: number }; emailStyleNotes: string[] };
    expect(p.email.maxWords).toBeLessThan(DEFAULT_ICP.email.maxWords);
    expect(p.emailStyleNotes[0]).toMatch(/under \d+ words/);
  });
});

describe("learning: guards against drift", () => {
  const sent = [
    ...Array.from({ length: 5 }, (_, i) => row({ id: i, outcome: "replied", lines: lines({ enterprise: 0.9, trigger: 0.9 }) })),
    ...Array.from({ length: 6 }, (_, i) => row({ id: 10 + i, outcome: "no_reply", lines: lines({ enterprise: 0.3, trigger: 0.4 }) })),
  ];
  it("after applying a kind it stays quiet until 5 NEW records arrive (no ratcheting)", () => {
    const d = { ...empty, sent };
    expect(suggest(d, DEFAULT_ICP).some((s) => s.kind === "weights")).toBe(true);
    const cooldown = { weights: sent.length };
    expect(suggest(d, DEFAULT_ICP, cooldown).some((s) => s.kind === "weights")).toBe(false);
    const more = { ...empty, sent: [...sent, ...Array.from({ length: 5 }, (_, i) => row({ id: 100 + i, outcome: "replied", lines: lines({ enterprise: 0.9, trigger: 0.9 }) }))] };
    expect(suggest(more, DEFAULT_ICP, cooldown).some((s) => s.kind === "weights")).toBe(true);
  });
  it("never proposes banning wording that contains the company name", () => {
    const edited = [1, 2, 3, 4].map((i) => row({ id: i, edited: true, removed: ["Sprinto automates compliance evidence collection for teams."], origWords: 100, finalWords: 95 }));
    const s = suggest({ ...empty, sent: edited }, DEFAULT_ICP).find((x) => x.kind === "phrases");
    const banned = s ? (s.patch as { email: { bannedPhrases: string[] } }).email.bannedPhrases : [];
    expect(banned.some((p) => p.includes("sprinto"))).toBe(false);
  });
});

describe("learning: contacts and the maybe band", () => {
  it("raises the auto-accept bar when you override often, and reports the top reason", () => {
    const contacts = [
      { mode: "override" as const, title: "Head of Security", reason: "wrong role" }, { mode: "override" as const, title: "CISO", reason: "wrong role" },
      { mode: "confirmed" as const, title: "CTO", reason: null }, { mode: "override" as const, title: "Security Lead", reason: "better fit" },
    ];
    const s = suggest({ ...empty, contacts }, DEFAULT_ICP).find((x) => x.kind === "autoaccept")!;
    expect((s.patch as { hunter: { autoAcceptScore: number } }).hunter.autoAcceptScore).toBe(DEFAULT_ICP.hunter.autoAcceptScore + 10);
    expect(s.evidence.join(" ")).toMatch(/wrong role/);
  });
  it("learns a title keyword you pick repeatedly, and the ranker then boosts it", () => {
    const contacts = [
      { mode: "override" as const, title: "Head of Trust", reason: null }, { mode: "override" as const, title: "Trust & Safety Lead", reason: null },
      { mode: "confirmed" as const, title: "CTO", reason: null }, { mode: "confirmed" as const, title: "CEO", reason: null },
    ];
    const s = suggest({ ...empty, contacts }, DEFAULT_ICP).find((x) => x.kind === "titles")!;
    const kw = (s.patch as { preferredTitleKeywords: string[] }).preferredTitleKeywords;
    expect(kw).toContain("trust");
    const p: HunterPerson = { email: "a@b.co", first_name: "Ana", last_name: "Z", position: "Trust Manager", seniority: "senior", department: null, confidence: 50, verified: false };
    expect(scorePerson(p, true, kw).score).toBeGreaterThan(scorePerson(p, true, []).score);
    expect(pickContact([p], true, 50, kw).chosen).not.toBeNull();
  });
  it("lowers the Flagged threshold when you qualify most maybe-band accounts", () => {
    const maybes = [{ score: 55, action: "qualify" as const }, { score: 52, action: "qualify" as const }, { score: 58, action: "qualify" as const }, { score: 50, action: "qualify" as const }, { score: 45, action: "disqualify" as const }];
    const s = suggest({ ...empty, maybes }, DEFAULT_ICP).find((x) => x.kind === "maybe")!;
    expect((s.patch as { thresholds: { flagged: number } }).thresholds.flagged).toBe(50);
  });
  it("needs the minimum sample before it acts", () => {
    expect(MIN.maybes).toBeGreaterThanOrEqual(5);
    const maybes = [{ score: 55, action: "qualify" as const }, { score: 52, action: "qualify" as const }];
    expect(suggest({ ...empty, maybes }, DEFAULT_ICP).find((x) => x.kind === "maybe")).toBeUndefined();
  });
});
