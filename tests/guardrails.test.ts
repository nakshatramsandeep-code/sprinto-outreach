import { describe, it, expect } from "vitest";
import { cleanHtml, pickCandidateUrls, quoteInText } from "../lib/clean";
import { normalizeDomain, isPrivateHost, isBlockedCompany, nameMatches } from "../lib/domain";
import { decide, newLoopState } from "../lib/loop";
import { emptyFields, mergeExtraction } from "../lib/fields";
import { pickContact, type HunterPerson } from "../lib/rank";
import { validateDraft } from "../lib/email";
import { detectChallenge } from "../lib/fetcher";
import { CONFIG } from "../lib/config";

const person = (o: Partial<HunterPerson>): HunterPerson => ({
  email: "a@b.com", first_name: "Asha", last_name: "Rao", position: "Head of Security", seniority: "senior",
  department: "it", confidence: 90, verified: true, ...o,
});

describe("cleaning", () => {
  const html = `<html><head><title>Acme - Payroll for SMEs</title><meta name="description" content="Acme automates payroll for finance teams at growing companies."></head>
  <body><nav><a href="/careers">Careers</a><a href="/security">Security</a></nav>
  <div class="cookie-banner">We use cookies to improve your experience please accept all cookies now</div>
  <h1>Payroll that runs itself</h1><p>Acme helps finance teams at mid-sized businesses run payroll without spreadsheets or errors.</p>
  <p>Acme helps finance teams at mid-sized businesses run payroll without spreadsheets or errors.</p>
  <ul><li>Login</li><li>Senior Security Engineer</li></ul>
  <footer><p>Copyright Acme Inc all rights reserved privacy terms of service contact us today</p></footer></body></html>`;

  it("drops nav, footer, cookie text and duplicates", () => {
    const r = cleanHtml(html);
    expect(r.text).toContain("Payroll that runs itself");
    expect(r.text).not.toMatch(/cookies/i);
    expect(r.text).not.toMatch(/Copyright/);
    expect(r.text.match(/without spreadsheets/g)?.length).toBe(1);
  });
  it("keeps short job titles only when keepShort is set", () => {
    expect(cleanHtml(html).text).not.toContain("Senior Security Engineer");
    expect(cleanHtml(html, { keepShort: true }).text).toContain("Senior Security Engineer");
  });
  it("collects nav links before removing nav, and picks topic pages", () => {
    const r = cleanHtml(html);
    const urls = pickCandidateUrls("https://acme.io/", r.links, "cert");
    expect(urls[0]).toBe("https://acme.io/security");
  });
  it("caps output near 2,000 tokens", () => {
    const big = "<body>" + Array.from({ length: 400 }, (_, i) => `<p>Unique sentence number ${i} about automated payroll for finance teams everywhere.</p>`).join("") + "</body>";
    expect(cleanHtml(big).approxTokens).toBeLessThanOrEqual(CONFIG.scrape.maxCleanTokens + 20);
  });
});

describe("evidence verification (anti-hallucination)", () => {
  it("accepts a quote that is really in the page and rejects an invented one", () => {
    const text = "We are SOC 2 Type II certified and proud of it.";
    expect(quoteInText("SOC 2 Type II certified", text)).toBe(true);
    expect(quoteInText("ISO 27001 certified", text)).toBe(false);
  });
  it("mergeExtraction drops fields whose quote is not in the text", () => {
    const f = mergeExtraction(emptyFields(), {
      funding_stage: { value: "Series B", quote: "raised a Series B led by Acme Capital" },
      is_b2b_saas: { value: true, quote: "software for finance teams" },
    }, "Our software for finance teams helps payroll.", "https://x.io/");
    expect(f.is_b2b_saas.value).toBe(true);
    expect(f.funding_stage.value).toBeNull();
  });
});

describe("domain safety", () => {
  it("normalises and rejects bad or private hosts", () => {
    expect(normalizeDomain("https://www.Acme.io/pricing")).toBe("acme.io");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("http://192.168.1.5")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });
  it("blocks competitors and giants", () => {
    expect(isBlockedCompany("vanta.com")).toBe("competitor");
    expect(isBlockedCompany("google.com")).toBe("too_big");
    expect(isBlockedCompany("acme.io")).toBeNull();
  });
  it("detects a hallucinated company by name mismatch", () => {
    expect(nameMatches("Acme Payroll", "acme.io", "Acme automates payroll")).toBe(true);
    expect(nameMatches("Zentrix Labs", "zentrix.io", "Buy cheap sneakers online")).toBe(false);
  });
  it("detects challenge pages that return HTTP 200", () => {
    expect(detectChallenge("<title>Just a moment...</title>")).toBe("bot_protection");
    expect(detectChallenge("<div class='g-recaptcha'></div>")).toBe("captcha");
    expect(detectChallenge("<h1>Hello</h1>")).toBeNull();
  });
});

describe("loop decisions (code decides, not the model)", () => {
  const ev = (value: any) => ({ value, quote: "q", url: "u" });
  const base = () => { const f = emptyFields(); f.is_b2b_saas = ev(true); return f; };

  it("disqualifies immediately when a certification is found", () => {
    const f = base(); f.certifications.push({ name: "SOC 2", quote: "q", url: "u" });
    expect(decide(newLoopState(f))).toEqual({ action: "disqualify", reason: "already_certified" });
  });
  it("disqualifies when not B2B SaaS", () => {
    const f = emptyFields(); f.is_b2b_saas = ev(false);
    expect(decide(newLoopState(f))).toEqual({ action: "disqualify", reason: "not_b2b_saas" });
  });
  it("fetches for product type once, then hands to a human", () => {
    const s = newLoopState(emptyFields());
    expect(decide(s)).toMatchObject({ action: "fetch", topic: "saas" });
    s.tried.saas = 1; s.fetchesUsed = 1;
    expect(decide(s)).toEqual({ action: "manual_review", reason: "product_type_unknown" });
  });
  it("checks security page once, then stage up to twice, then qualifies flagged", () => {
    const s = newLoopState(base());
    expect(decide(s)).toMatchObject({ action: "fetch", topic: "cert" });
    s.tried.cert = 1; s.fetchesUsed = 1; s.securityPageRead = true;
    expect(decide(s)).toMatchObject({ action: "fetch", topic: "stage" });
    s.tried.stage = 1; s.fetchesUsed = 2;
    expect(decide(s)).toMatchObject({ action: "fetch", topic: "stage" });
    s.tried.stage = 2; s.fetchesUsed = 3;
    const d = decide(s);
    expect(d.action).toBe("qualify");
    if (d.action === "qualify") expect(d.flags).toContain("stage_unknown");
  });
  it("never exceeds the fetch cap", () => {
    const s = newLoopState(base());
    s.fetchesUsed = CONFIG.loop.maxExtraFetches;
    expect(decide(s).action).toBe("qualify"); // hands off flagged instead of fetching more
  });
  it("qualifies cleanly with stage evidence and a read security page", () => {
    const f = base(); f.funding_stage = ev("Series B");
    const s = newLoopState(f); s.securityPageRead = true; s.tried.cert = 1;
    const d = decide(s);
    expect(d.action).toBe("qualify");
    if (d.action === "qualify") { expect(d.flags).toEqual([]); expect(d.rank).toBeGreaterThanOrEqual(100); }
  });
});

describe("contact ranking", () => {
  it("prefers a security leader over a generic manager", () => {
    const r = pickContact([
      person({ position: "Marketing Manager", seniority: "senior", email: "m@x.com" }),
      person({ position: "Head of Security", email: "s@x.com" }),
    ], true);
    expect(r.chosen?.email).toBe("s@x.com");
  });
  it("returns nobody rather than a random person", () => {
    const r = pickContact([person({ position: "Customer Success Associate", seniority: "junior" })], true);
    expect(r.chosen).toBeNull();
  });
  it("accepts founders at small companies", () => {
    const r = pickContact([person({ position: "Co-founder & CEO", seniority: "executive" })], true);
    expect(r.chosen).not.toBeNull();
  });
});

describe("email validator", () => {
  const evidence = { funding_stage: 'Series B - "raised a Series B"', open_roles: '6 - "six open roles including Security Engineer"' };
  const good = {
    pains: [{ pain: "Security reviews stall enterprise deals", evidence_field: "open_roles" }, { pain: "No owner for audit evidence", evidence_field: "funding_stage" }],
    hook_field: "open_roles",
    subject: "Your open Security Engineer role",
    body: "Hi Asha, I noticed Acme has six open roles including a Security Engineer, which usually means enterprise security reviews are starting to land on a small team. " +
      "Sprinto automates SOC 2 and ISO 27001 so that work stops falling on engineers, and audit evidence is collected continuously instead of in a scramble before each review. " +
      "Teams in your position often reach certification in weeks rather than quarters. Would a short call next week be useful, or should I send a two-page overview first? Growth Team, Sprinto",
  };
  it("passes a grounded draft", () => {
    const v = validateDraft(good, "Asha", evidence);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it("fails placeholders, missing name and ungrounded hooks", () => {
    const bad = { ...good, body: "Hi [Name], Sprinto is revolutionary for compliance.", hook_field: "made_up" };
    const v = validateDraft(bad, "Asha", evidence);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/placeholder/);
    expect(v.problems.join(" ")).toMatch(/first name/);
    expect(v.problems.join(" ")).toMatch(/evidence/);
  });
});
