import { describe, it, expect } from "vitest";
import { scoreCompany, stageAllowed } from "../lib/score";
import { DEFAULT_ICP, validateIcp, withDefaults } from "../lib/icp";
import { emptyFields } from "../lib/fields";
import { parseRss } from "../lib/discover";
import { pickContact, type HunterPerson } from "../lib/rank";
import { decide, newLoopState } from "../lib/loop";

const ev = <T,>(value: T, quote = "q") => ({ value, quote, url: "u" });
const person = (o: Partial<HunterPerson>): HunterPerson => ({
  email: "a@b.com", first_name: "Asha", last_name: "Rao", position: "Head of Security", seniority: "senior", department: "it", confidence: 90, verified: true, ...o,
});

describe("scoring", () => {
  it("a strong, triggered, sensitive-sector SaaS lands in tier A with every point explained", () => {
    const f = emptyFields();
    f.is_b2b_saas = ev(true); f.buyer = ev("security teams at banks"); f.funding_stage = ev("Series B");
    f.enterprise_signal = ev(true); f.compliance_hiring = ev("First Compliance Manager", "First Compliance Manager");
    const r = scoreCompany({ fields: f, discovery: { source: "gemini_search", quote: "preparing for SOC 2 audit" }, flags: [] }, DEFAULT_ICP);
    expect(r.tier).toBe("A");
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_ICP.thresholds.qualified);
    expect(r.lines).toHaveLength(5);
    expect(r.lines.reduce((a, l) => a + l.max, 0)).toBe(100);
    expect(r.lines.every((l) => l.why.length > 0)).toBe(true);
  });
  it("an unknown company with no evidence is dropped (tier D)", () => {
    const r = scoreCompany({ fields: emptyFields(), discovery: null, flags: ["cert_unconfirmed", "stage_unknown"] }, DEFAULT_ICP);
    expect(r.tier).toBe("D");
    expect(r.penalties.map((p) => p.pts)).toEqual([DEFAULT_ICP.penalties.certUnverified, DEFAULT_ICP.penalties.stageUnknown]);
  });
  it("penalties reduce the score", () => {
    const f = emptyFields(); f.is_b2b_saas = ev(true); f.funding_stage = ev("Series A");
    const clean = scoreCompany({ fields: f, discovery: null, flags: [] }, DEFAULT_ICP).score;
    const flagged = scoreCompany({ fields: f, discovery: null, flags: ["cert_unconfirmed"] }, DEFAULT_ICP).score;
    expect(clean - flagged).toBe(DEFAULT_ICP.penalties.certUnverified);
  });
  it("a recent funding round inside the window counts as the trigger; an old one does not", () => {
    const f = emptyFields(); f.is_b2b_saas = ev(true);
    const now = Date.parse("2026-11-18");
    const recent = scoreCompany({ fields: f, discovery: { source: "funding_news", published_at: "2026-11-10T00:00:00Z" }, flags: [], now }, DEFAULT_ICP);
    const old = scoreCompany({ fields: f, discovery: { source: "funding_news", published_at: "2026-01-10T00:00:00Z" }, flags: [], now }, DEFAULT_ICP);
    expect(recent.lines.find((l) => l.key === "trigger")!.got).toBe(25);
    expect(old.lines.find((l) => l.key === "trigger")!.got).toBeLessThan(10);
  });
  it("stage matching handles variants and the Series D+ bucket", () => {
    expect(stageAllowed("Series B", ["Series B"])).toBe(true);
    expect(stageAllowed("series-b round", ["Series B"])).toBe(true);
    expect(stageAllowed("Series E", ["Series D+"])).toBe(true);
    expect(stageAllowed("Seed", ["Series A"])).toBe(false);
    expect(stageAllowed(null, ["Series A"])).toBeNull();
  });
  it("changing thresholds changes the tier (what the ICP page edits)", () => {
    const f = emptyFields(); f.is_b2b_saas = ev(true); f.buyer = ev("finance teams"); f.funding_stage = ev("Series A");
    const input = { fields: f, discovery: { source: "gemini_search", quote: "hiring a compliance manager" }, flags: [] as string[] };
    const base = scoreCompany(input, DEFAULT_ICP);
    const strict = scoreCompany(input, withDefaults({ thresholds: { qualified: 99, flagged: 98, maybe: 97 } }));
    expect(strict.score).toBe(base.score);
    expect(strict.tier).toBe("D");
  });
});

describe("ICP config validation", () => {
  it("defaults are valid and weights total 100", () => {
    expect(validateIcp(DEFAULT_ICP)).toEqual([]);
  });
  it("rejects weights that do not total 100, bad threshold order, and a cap outside 1-6", () => {
    const bad = withDefaults({ weights: { ...DEFAULT_ICP.weights, saas: 50 }, thresholds: { qualified: 50, flagged: 60, maybe: 40 }, loopFetchCap: 9 });
    const problems = validateIcp(bad).join(" | ");
    expect(problems).toMatch(/total 100/);
    expect(problems).toMatch(/thresholds/);
    expect(problems).toMatch(/1 to 6/);
  });
  it("older stored configs get new fields from the defaults", () => {
    const merged = withDefaults({ loopFetchCap: 3 } as never);
    expect(merged.loopFetchCap).toBe(3);
    expect(merged.followUpDays).toEqual([3, 7, 14]);
    expect(merged.weights.trigger).toBe(25);
  });
});

describe("funding news RSS", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Acme raises $15M Series A to automate payroll - TechWire]]></title><link>https://example.com/a</link><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate><source url="x">TechWire</source></item>
    <item><title>Beta &amp; Co lands Series B</title><link>https://example.com/b</link></item>
    <item><title>No link here</title></item>
  </channel></rss>`;
  it("parses items, decodes entities, and skips broken ones", () => {
    const items = parseRss(xml, "feed");
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("Acme raises $15M Series A");
    expect(items[0].source).toBe("TechWire");
    expect(items[1].title).toBe("Beta & Co lands Series B");
  });
});

describe("contact choice with a human fallback", () => {
  it("auto-accepts above the bar, offers a best match below it, offers nothing for junk", () => {
    const strong = pickContact([person({ position: "Head of Security" })], true, 50);
    expect(strong.chosen).not.toBeNull();
    const meh = pickContact([person({ position: "Co-Founder", seniority: "executive", confidence: 30, verified: false })], false, 70);
    expect(meh.chosen).toBeNull();
    expect(meh.best).not.toBeNull();
    const junk = pickContact([person({ position: "Customer Success Associate", seniority: "junior" })], true, 50);
    expect(junk.chosen).toBeNull();
    expect(junk.best).toBeNull();
  });
});

describe("loop cap comes from config", () => {
  it("a lower cap stops fetching sooner and qualifies flagged", () => {
    const f = emptyFields(); f.is_b2b_saas = ev(true);
    const s = newLoopState(f);
    s.fetchesUsed = 2;
    expect(decide(s, { cap: 2 }).action).toBe("qualify");
    expect(decide(s, { cap: 4 }).action).toBe("fetch");
  });
});
