import { describe, it, expect } from "vitest";
import { runLoopSimulation, simulateWeights, simulateEdits, simulateContacts, simulateStability, rng } from "../lib/loopsim";

// These are the PROOF that the feedback loop helps and does not learn from noise. Seeded, so they are reproducible.
describe("feedback loop: simulation proofs", () => {
  const report = runLoopSimulation(40);

  it("the generator is reproducible", () => {
    const a = rng(5), b = rng(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("learned weights rank accounts closer to their TRUE reply odds", () => {
    const s = report.weights.signal;
    expect(s.meanCorrAfter).toBeGreaterThan(s.meanCorrBefore);
    expect(s.gainCaptured).toBeGreaterThanOrEqual(0.15); // learning is deliberately slow: it needs fresh batches of 40+ outcomes per change
    expect(report.weightsLong.signal.gainCaptured).toBeGreaterThan(s.gainCaptured); // ...and gets better as data accumulates
    expect(report.weightsLong.signal.gainCaptured).toBeGreaterThanOrEqual(0.4);
    expect(report.weightsLong.nullWorld.pctSeedsChangedWeights).toBeLessThanOrEqual(0.1);
    expect(s.pctSeedsImproved).toBeGreaterThanOrEqual(0.8);
    expect(s.worstChange).toBeGreaterThanOrEqual(-0.01); // learning never makes a run meaningfully worse
    expect(s.meanLiftAfter).toBeGreaterThan(s.meanLiftBefore); // top quartile by score is richer in repliers
    expect(s.meanEnterpriseTriggerShift).toBeGreaterThan(0); // and it moved weight toward the right components
  });

  it("does NOT change weights when replies are pure noise (false-change rate <= 10%)", () => {
    expect(report.weights.nullWorld.pctSeedsChangedWeights).toBeLessThanOrEqual(0.1);
  });

  it("a phrase the owner always deletes gets banned and the edit rate collapses", () => {
    const e = report.edits;
    expect(e.withFlaw.pctSeedsLearned).toBeGreaterThanOrEqual(0.9);
    expect(1 - e.withFlaw.editRateAfter / e.withFlaw.editRateBefore).toBeGreaterThanOrEqual(0.6);
  });

  it("scattered edits do not trigger a ban", () => {
    expect(report.edits.nullWorld.pctSeedsProposedBan).toBeLessThanOrEqual(0.1);
  });

  it("a consistent contact preference is learned and agreement with the owner rises", () => {
    const c = report.contacts;
    expect(c.preference.pctSeedsLearned).toBeGreaterThanOrEqual(0.8);
    expect(c.preference.agreementAfter - c.preference.agreementBefore).toBeGreaterThanOrEqual(0.15);
  });

  it("random contact choices do not teach it a preference", () => {
    expect(report.contacts.nullWorld.pctSeedsProposedKeyword).toBeLessThanOrEqual(0.1);
  });

  it("with too little data nothing fires, and replaying the same data cannot ratchet the weights", () => {
    expect(report.stability.tinyDataSuggestions).toBe(0);
    expect(report.stability.maxWeightDriftAfterFirstApply).toBe(0);
    expect(report.stability.weightsAfter10Rounds.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("all release gates pass", () => {
    expect(report.gates.filter((g) => !g.pass).map((g) => `${g.name}: ${g.value} (${g.threshold})`)).toEqual([]);
    expect(report.allPass).toBe(true);
  });

  it("is stable across different seed counts (not a lucky seed)", () => {
    const small = simulateWeights(15), big = simulateWeights(60);
    expect(small.signal.meanCorrAfter).toBeGreaterThan(small.signal.meanCorrBefore);
    expect(big.signal.meanCorrAfter).toBeGreaterThan(big.signal.meanCorrBefore);
    expect(simulateEdits(15).withFlaw.editRateAfter).toBeLessThan(simulateEdits(15).withFlaw.editRateBefore);
    expect(simulateContacts(15).preference.agreementAfter).toBeGreaterThan(simulateContacts(15).preference.agreementBefore);
    expect(simulateStability().tinyDataSuggestions).toBe(0);
  });
});
