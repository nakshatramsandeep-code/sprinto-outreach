import * as cheerio from "cheerio";
import { CONFIG } from "./config";

export type CleanResult = {
  text: string;
  wordCount: number;
  approxTokens: number;
  links: { href: string; label: string }[];
};

const NOISE =
  "script,style,noscript,nav,footer,aside,form,iframe,svg,button,select,[role=navigation],[role=banner] nav," +
  "[aria-label*=cookie i],[class*=cookie i],[id*=cookie i],[class*=consent i],[id*=consent i],[class*=gdpr i]";

const countWords = (s: string) => (s.match(/\S+/g) ?? []).length;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * HTML -> short model-ready text.
 * Strips nav/footer/cookie banners, dedupes blocks, caps at ~2,000 tokens.
 * keepShort=true keeps short list items (job titles, pricing tiers) for careers/pricing/customers pages.
 */
export function cleanHtml(html: string, opts: { keepShort?: boolean } = {}): CleanResult {
  const $ = cheerio.load(html);

  // Collect internal links BEFORE removing nav (nav is where the /careers, /security links are).
  const links: { href: string; label: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const label = $(el).text().replace(/\s+/g, " ").trim().slice(0, 60);
    if (href && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:")) {
      links.push({ href, label });
    }
  });

  $(NOISE).remove();

  const blocks: string[] = [];
  const title = $("title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() ?? "";
  if (title) blocks.push(title);
  if (metaDesc) blocks.push(metaDesc);
  if (ogDesc && ogDesc !== metaDesc) blocks.push(ogDesc);

  const minWords = opts.keepShort ? 2 : 6;
  $("h1,h2,h3,h4,p,li,td,dd,blockquote,figcaption").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    const tag = (el as { tagName?: string }).tagName ?? "";
    const isHeading = /^h[1-4]$/.test(tag);
    if (!t) return;
    if (!isHeading && countWords(t) < minWords) return;
    blocks.push(t);
  });

  const seen = new Set<string>();
  const kept: string[] = [];
  let chars = 0;
  const maxChars = CONFIG.scrape.maxCleanTokens * 4; // ~4 chars per token
  for (const b of blocks) {
    const key = norm(b);
    if (seen.has(key)) continue;
    seen.add(key);
    if (chars + b.length > maxChars) break;
    kept.push(b);
    chars += b.length + 1;
  }

  const text = kept.join("\n");
  return { text, wordCount: countWords(text), approxTokens: Math.ceil(text.length / 4), links };
}

// Pick likely internal URLs for a topic from a page's links. Falls back to guessed paths.
export const TOPIC_PATHS: Record<string, { keywords: string[]; guesses: string[] }> = {
  cert: { keywords: ["security", "trust", "compliance"], guesses: ["/security", "/trust"] },
  stage: { keywords: ["careers", "jobs", "pricing", "customers"], guesses: ["/careers", "/pricing", "/customers"] },
  saas: { keywords: ["product", "platform", "about", "solutions"], guesses: ["/product", "/about"] },
};

// A path segment counts as a topic page only when it IS the topic ("security", "trust-center"),
// not merely contains the word ("ai-security-posture-management" is a product page, not a trust page).
export function isTopicSegment(seg: string, kw: string): boolean {
  const s = seg.toLowerCase();
  return s === kw || s === `${kw}-center` || s === `${kw}-centre` || s === `${kw}-and-compliance` || s === `${kw}-compliance`;
}

export function pickCandidateUrls(
  base: string,
  links: { href: string; label: string }[],
  topic: keyof typeof TOPIC_PATHS,
  opts: { guess?: boolean } = {},
): string[] {
  const { keywords, guesses } = TOPIC_PATHS[topic];
  const guessAllowed = opts.guess ?? true; // false when a sitemap already told us what pages exist
  const origin = new URL(base).origin;
  const host = new URL(base).hostname.replace(/^www\./, "");
  const found: string[] = [];
  for (const kw of keywords) {
    for (const l of links) {
      try {
        const u = new URL(l.href, base);
        if (u.hostname.replace(/^www\./, "") !== host) continue;
        const segs = u.pathname.split("/").filter(Boolean);
        if (segs.length === 0 || segs.length > 2) continue;
        const pathMatch = segs.some((s) => isTopicSegment(s, kw));
        const labelMatch = l.label.trim().toLowerCase() === kw && segs.length === 1; // nav link literally labelled "Security"
        if (pathMatch || labelMatch) found.push(u.origin + u.pathname);
      } catch {}
    }
  }
  const all = [...found, ...(guessAllowed ? guesses.map((g) => origin + g) : [])];
  return [...new Set(all)];
}

// Verify a model-supplied quote really appears in the source text (anti-hallucination).
export function quoteInText(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = strip(quote);
  if (q.length < 4) return false;
  return strip(text).includes(q);
}
