import robotsParser from "robots-parser";
import { lookup } from "node:dns/promises";
import { CONFIG } from "./config";
import { q } from "./db";
import { cleanHtml } from "./clean";
import { isPrivateHost } from "./domain";

export type FailReason =
  | "invalid_url"
  | "private_address"
  | "robots_disallowed"
  | "blocked_or_login" // 401/403
  | "bot_protection" // Cloudflare-style challenge
  | "captcha"
  | "rate_limited"
  | "not_found"
  | "non_html"
  | "timeout"
  | "network_error"
  | "thin_content";

// Reasons where we STOP. We never try to get around a barrier the site owner put up.
export const HARD_STOP: FailReason[] = ["robots_disallowed", "blocked_or_login", "bot_protection", "captcha", "rate_limited"];

export class FetchError extends Error {
  constructor(public reason: FailReason, public url: string, msg?: string) {
    super(msg ?? `${reason}: ${url}`);
  }
}

export type Page = {
  url: string;
  text: string;
  links: { href: string; label: string }[];
  method: "plain" | "render_fallback" | "cache";
  wordCount: number;
};

// ---- polite delay: at least minHostGapMs between hits to one host (in-memory, per instance) ----
const lastHit = new Map<string, number>();
async function politeWait(host: string) {
  const now = Date.now();
  const wait = (lastHit.get(host) ?? 0) + CONFIG.scrape.minHostGapMs - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

// ---- robots.txt (cached per origin for the life of the instance) ----
const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();
async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  const robotsUrl = `${u.origin}/robots.txt`;
  if (!robotsCache.has(u.origin)) {
    try {
      await politeWait(u.hostname);
      const res = await fetch(robotsUrl, {
        headers: { "user-agent": CONFIG.scrape.userAgent },
        signal: AbortSignal.timeout(CONFIG.scrape.timeoutMs),
      });
      robotsCache.set(u.origin, res.ok ? robotsParser(robotsUrl, await res.text()) : null);
    } catch {
      robotsCache.set(u.origin, null); // no readable robots.txt = no rules published
    }
  }
  const r = robotsCache.get(u.origin);
  if (!r) return true;
  return r.isAllowed(url, CONFIG.scrape.userAgent) !== false;
}

async function assertPublic(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new FetchError("invalid_url", url);
  }
  if (!/^https?:$/.test(u.protocol)) throw new FetchError("invalid_url", url);
  if (isPrivateHost(u.hostname)) throw new FetchError("private_address", url);
  try {
    const addrs = await lookup(u.hostname, { all: true });
    if (addrs.some((a) => isPrivateHost(a.address))) throw new FetchError("private_address", url);
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError("network_error", url, "dns lookup failed");
  }
}

// Detect a challenge page that returned 200 (a silent failure).
export function detectChallenge(html: string): FailReason | null {
  const h = html.slice(0, 20_000).toLowerCase();
  if (h.includes("just a moment...") || h.includes("cf-chl") || h.includes("attention required! | cloudflare") || h.includes("checking your browser")) return "bot_protection";
  if (h.includes("g-recaptcha") || h.includes("hcaptcha") || h.includes("verify you are human") || h.includes("are you a robot")) return "captcha";
  return null;
}

async function plainFetch(url: string): Promise<string> {
  await politeWait(new URL(url).hostname);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": CONFIG.scrape.userAgent, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(CONFIG.scrape.timeoutMs),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new FetchError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error", url);
  }
  // Re-check where redirects landed.
  try {
    if (isPrivateHost(new URL(res.url).hostname)) throw new FetchError("private_address", url);
  } catch (e) {
    if (e instanceof FetchError) throw e;
  }
  if (res.status === 401 || res.status === 403) throw new FetchError("blocked_or_login", url);
  if (res.status === 429) throw new FetchError("rate_limited", url);
  if (res.status === 404 || res.status === 410) throw new FetchError("not_found", url);
  if (!res.ok) throw new FetchError("network_error", url, `http ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html") && !ct.includes("text/")) throw new FetchError("non_html", url);
  const buf = await res.arrayBuffer();
  const html = new TextDecoder().decode(buf.slice(0, CONFIG.scrape.maxBytes));
  const challenge = detectChallenge(html);
  if (challenge) throw new FetchError(challenge, url);
  return html;
}

// JS-rendered pages arrive nearly empty. Jina Reader renders and returns clean text.
// Only used when the page was thin AND not blocked. robots.txt was already checked.
async function renderFallback(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { accept: "text/plain", "x-return-format": "text" },
      signal: AbortSignal.timeout(CONFIG.scrape.timeoutMs * 2),
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, CONFIG.scrape.maxBytes);
  } catch {
    return null;
  }
}

const wordsOf = (s: string) => (s.match(/\S+/g) ?? []).length;

export async function getPage(url: string, opts: { keepShort?: boolean } = {}): Promise<Page> {
  await assertPublic(url);

  // 1. cache (a company researched this week costs nothing)
  const cached = await q<{ text: string; links: Page["links"]; word_count: number }>(
    "SELECT text, links, word_count FROM pages WHERE url=$1 AND fetched_at > now() - ($2 || ' days')::interval",
    [url, String(CONFIG.scrape.cacheDays)],
  );
  if (cached[0]) {
    return { url, text: cached[0].text, links: cached[0].links, method: "cache", wordCount: cached[0].word_count };
  }

  // 2. robots.txt - the owner's published rulebook
  if (!(await robotsAllows(url))) throw new FetchError("robots_disallowed", url);

  // 3. plain request
  const html = await plainFetch(url);
  const cleaned = cleanHtml(html, opts);
  let page: Page = { url, text: cleaned.text, links: cleaned.links, method: "plain", wordCount: cleaned.wordCount };

  // 4. thin result -> maybe JS-rendered -> try the render fallback once
  if (page.wordCount < CONFIG.scrape.thinWordCount) {
    const rendered = await renderFallback(url);
    if (rendered && wordsOf(rendered) > page.wordCount) {
      const text = rendered.split(/\n+/).map((s) => s.trim()).filter((s) => wordsOf(s) >= 4).join("\n").slice(0, CONFIG.scrape.maxCleanTokens * 4);
      page = { url, text, links: page.links, method: "render_fallback", wordCount: wordsOf(text) };
    }
  }

  // 5. silent-failure check: still nearly empty = say so, do not pass junk on
  if (page.wordCount < CONFIG.scrape.minUsefulWords) throw new FetchError("thin_content", url);

  await q(
    `INSERT INTO pages (url, text, links, method, word_count) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (url) DO UPDATE SET text=$2, links=$3, method=$4, word_count=$5, fetched_at=now()`,
    [url, page.text, JSON.stringify(page.links.slice(0, 200)), page.method, page.wordCount],
  );
  return page;
}

// ---- Non-HTML fetch for sitemaps: same guardrails (public host, robots.txt, polite delay, timeout, size cap) ----
export async function fetchRaw(url: string, maxBytes = 3_000_000): Promise<string | null> {
  await assertPublic(url);
  if (!(await robotsAllows(url))) throw new FetchError("robots_disallowed", url);
  await politeWait(new URL(url).hostname);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": CONFIG.scrape.userAgent, accept: "application/xml,text/xml,text/plain,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(CONFIG.scrape.timeoutMs),
    });
    if (isPrivateHost(new URL(res.url).hostname) || !res.ok) return null;
    const buf = await res.arrayBuffer();
    return new TextDecoder().decode(buf.slice(0, maxBytes));
  } catch {
    return null;
  }
}

// Sitemap URLs the site itself declares in robots.txt (empty if none).
export async function sitemapsFor(origin: string): Promise<string[]> {
  await robotsAllows(origin + "/"); // loads and caches robots.txt for this origin
  const r = robotsCache.get(origin);
  return (r && typeof r.getSitemaps === "function" ? r.getSitemaps() : []) ?? [];
}
