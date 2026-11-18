import { describe, it, expect } from "vitest";
import { parseSitemap, pickFromSitemap } from "../lib/sitemap";
import { extractBoardRefs, summariseJobs } from "../lib/ats";
import { pickCandidateUrls } from "../lib/clean";

describe("sitemap", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://acme.io/</loc></url>
    <url><loc>https://acme.io/security</loc></url>
    <url><loc>https://acme.io/careers</loc></url>
    <url><loc>https://acme.io/careers/senior-engineer</loc></url>
    <url><loc>https://acme.io/blog/how-we-got-soc-2-ready</loc></url>
    <url><loc>https://other.com/security</loc></url>
    <url><loc>https://acme.io/pricing?plan=a&amp;b=1</loc></url>
  </urlset>`;
  it("parses urls and detects an index file", () => {
    expect(parseSitemap(xml).urls.length).toBe(7);
    const idx = parseSitemap(`<sitemapindex><sitemap><loc>https://acme.io/s1.xml</loc></sitemap></sitemapindex>`);
    expect(idx.children).toEqual(["https://acme.io/s1.xml"]);
    expect(idx.urls).toEqual([]);
  });
  it("picks topic pages on the same site only, not blog posts or other domains", () => {
    const { urls } = parseSitemap(xml);
    expect(pickFromSitemap(urls, "https://acme.io/", "cert")).toEqual(["https://acme.io/security"]);
    const stage = pickFromSitemap(urls, "https://acme.io/", "stage");
    expect(stage[0]).toBe("https://acme.io/careers");
    expect(stage).toContain("https://acme.io/pricing");
    expect(stage.some((u) => u.includes("other.com"))).toBe(false);
  });
  it("does not mistake product pages that mention security for the security page", () => {
    const urls = ["https://v.io/security-posture", "https://v.io/platform/ai-security-posture-management", "https://v.io/trust-center"];
    expect(pickFromSitemap(urls, "https://v.io/", "cert")).toEqual(["https://v.io/trust-center"]);
    const links = [{ href: "/security-posture", label: "Security Posture" }, { href: "/platform/ai-security", label: "AI Security" }];
    expect(pickCandidateUrls("https://v.io/", links, "cert", { guess: false })).toEqual([]);
    expect(pickCandidateUrls("https://v.io/", [{ href: "/security", label: "Security" }], "cert", { guess: false })).toEqual(["https://v.io/security"]);
  });
  it("does not guess paths when a sitemap exists", () => {
    expect(pickCandidateUrls("https://acme.io/", [], "cert", { guess: false })).toEqual([]);
    expect(pickCandidateUrls("https://acme.io/", [], "cert")).toContain("https://acme.io/security");
  });
});

describe("job boards", () => {
  it("finds Greenhouse, Lever and Ashby boards from links", () => {
    const refs = extractBoardRefs([
      { href: "https://boards.greenhouse.io/acme" },
      { href: "https://job-boards.greenhouse.io/embed/job_board?for=acmeco" },
      { href: "https://jobs.lever.co/acme-inc/123" },
      { href: "https://jobs.ashbyhq.com/acme.io" },
      { href: "https://example.com/about" },
    ]);
    expect(refs.map((r) => `${r.provider}:${r.token}`)).toEqual(["greenhouse:acme", "greenhouse:acmeco", "lever:acme-inc", "ashby:acme.io"]);
  });
  it("counts roles and surfaces compliance and security hires", () => {
    const s = summariseJobs(["Senior Backend Engineer", "First Compliance Manager", "Account Executive", "Head of Security", "GRC Analyst"]);
    expect(s.count).toBe(5);
    expect(s.complianceTitles).toEqual(["First Compliance Manager", "Head of Security", "GRC Analyst"]);
  });
});
