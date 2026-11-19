import { describe, it, expect } from "vitest";
import { computeExtractionMetrics, checkEfficiency, percentile, EFFICIENCY, type Pred, type Expected } from "../lib/evals";
import { computeDue } from "../lib/followup";

const pred = (ms: number, tokens: number): Pred => ({ certified: false, saas: "yes", stage: null, rawFields: 4, rejected: 0, tokens, ms, evidence: { certs: [], stageQuote: null, saasQuote: null } });
const rowsOf = (spec: [number, number][]) => spec.map(([ms, tokens]) => ({ expected: { certified: false } as Expected, pred: pred(ms, tokens) }));

describe("efficiency gates for the research step", () => {
  it("percentiles pick the right values", () => {
    expect(percentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 0.5)).toBe(500);
    expect(percentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 0.95)).toBe(1000);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("a fast, cheap run passes every efficiency gate and reports a large speed-up over doing it by hand", () => {
    const m = computeExtractionMetrics(rowsOf([[4000, 2300], [5200, 2500], [6000, 2400], [4800, 2600], [5500, 2350]]));
    const gates = checkEfficiency(m, 0.5);
    expect(gates.every((g) => g.pass)).toBe(true);
    const speedup = Number(gates.find((g) => g.name.startsWith("Speed-up"))!.value.replace("x", ""));
    expect(speedup).toBeGreaterThanOrEqual(100); // 17.5 minutes by hand vs ~5 seconds
  });

  it("flags a run that is slow in the tail, token-hungry or expensive", () => {
    const slow = checkEfficiency(computeExtractionMetrics(rowsOf([[3000, 2000], [3000, 2000], [3000, 2000], [90_000, 2000]])), 0.5);
    expect(slow.find((g) => g.name.startsWith("Reading time"))!.pass).toBe(false);
    const hungry = checkEfficiency(computeExtractionMetrics(rowsOf([[3000, 15_000], [3000, 15_000]])), 0.5);
    expect(hungry.find((g) => g.name.startsWith("Tokens"))!.pass).toBe(false);
    const pricey = checkEfficiency(computeExtractionMetrics(rowsOf([[3000, 3500]])), 50);
    expect(pricey.find((g) => g.name.startsWith("Estimated LLM cost"))!.pass).toBe(false);
  });

  it("budgets match the case's goal (under 2 minutes, far cheaper than 15-20 minutes by hand)", () => {
    expect(EFFICIENCY.maxP95Ms).toBeLessThan(2 * 60_000);
    expect(EFFICIENCY.manualMinutes).toBeGreaterThanOrEqual(15);
    expect(EFFICIENCY.manualMinutes).toBeLessThanOrEqual(20);
  });
});

describe("follow-up scheduling is a pure function (so it can run inside one batched query)", () => {
  const sent = (company_id: number, days: number) => ({ id: company_id, company_id, sent_at: "2026-11-01", name: `C${company_id}`, domain: `c${company_id}.io`, chosen: { first_name: "Ann", last_name: "Lee" }, days });
  it("lists the latest due step once, skips ones already drafted, and ignores fresh emails", () => {
    const due = computeDue([sent(1, 1), sent(2, 4), sent(3, 9), sent(4, 20)], [{ company_id: 3, kind: "followup_7" }], [3, 7, 14]);
    expect(due.map((d) => `${d.company_id}:${d.day}`)).toEqual(["2:3", "4:14"]); // 1 too soon; 3's day-7 already drafted
    expect(due[0].person).toBe("Ann Lee");
  });
});
