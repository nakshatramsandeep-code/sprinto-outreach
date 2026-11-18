import { CONFIG, MODELS } from "./config";
import { q, logStep } from "./db";
import { gemini, parseJson, Meter } from "./gemini";
import { getPage, FetchError } from "./fetcher";
import { normalizeDomain, isBlockedCompany, nameMatches } from "./domain";
import { getIcp } from "./icp";
import { getAutoQueue, audit } from "./settings";
import { friendlyError } from "./errors";

export type Source = "hn_hiring" | "gemini_search" | "funding_news";
export type Candidate = {
  name: string;
  domain: string | null;
  quote: string;
  url: string | null;
  source: Source;
  query: string;
  score: number;
  stage?: string | null;
  published_at?: string | null;
};

export const SOURCE_LABEL: Record<Source, string> = { hn_hiring: "Hiring posts", gemini_search: "Web search", funding_news: "Funding news" };

// Signals that mean "compliance pressure". Each becomes a search.
const SIGNAL_QUERIES = [
  "B2B SaaS startup hiring a first compliance manager or GRC lead, Series A or Series B",
  "SaaS company hiring security engineer and preparing for SOC 2 audit",
  "B2B SaaS startup announces Series B funding and enterprise customers, needs security certification",
  "SaaS company working towards SOC 2 or ISO 27001 certification, no certification yet",
  "SaaS startup hiring head of security to answer enterprise security questionnaires",
];

export const NEWS_FEEDS: { label: string; url: string }[] = [
  { label: "Google News · SaaS raises Series A", url: "https://news.google.com/rss/search?q=SaaS+raises+Series+A&hl=en-US&gl=US&ceid=US:en" },
  { label: "Google News · Series B SaaS funding", url: "https://news.google.com/rss/search?q=Series+B+SaaS+funding&hl=en-US&gl=US&ceid=US:en" },
  { label: "Google News · B2B software raises", url: "https://news.google.com/rss/search?q=B2B+software+raises&hl=en-US&gl=US&ceid=US:en" },
  { label: "Google News · fintech SaaS Series A/B", url: "https://news.google.com/rss/search?q=fintech+SaaS+Series+A+OR+%22Series+B%22&hl=en-US&gl=US&ceid=US:en" },
  { label: "Google News · health SaaS Series A", url: "https://news.google.com/rss/search?q=health+SaaS+Series+A&hl=en-US&gl=US&ceid=US:en" },
  { label: "TechCrunch Venture", url: "https://techcrunch.com/category/venture/feed/" },
];

const STRONG_WORDS = /\b(soc ?2|iso ?27001|compliance|grc|security questionnaire|audit)\b/i;
const strength = (quote: string, base: number) => base + (STRONG_WORDS.test(quote) ? 1 : 0);

// ---------- Source 1: Hacker News "Who is hiring" (free Algolia API, no key) ----------
async function hnCandidates(meter: Meter, errs: string[]): Promise<Candidate[]> {
  try {
    const story = await fetch(
      "https://hn.algolia.com/api/v1/search_by_date?query=%22Ask%20HN%3A%20Who%20is%20hiring%22&tags=story,author_whoishiring&hitsPerPage=1",
      { signal: AbortSignal.timeout(10_000) },
    ).then((r) => r.json() as Promise<{ hits: { objectID: string }[] }>);
    const id = story.hits?.[0]?.objectID;
    if (!id) return [];

    const comments: string[] = [];
    for (const term of ["SOC 2", "compliance", "ISO 27001"]) {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(term)}&tags=comment,story_${id}&hitsPerPage=15`,
        { signal: AbortSignal.timeout(10_000) },
      ).then((r) => r.json() as Promise<{ hits: { comment_text?: string; objectID: string }[] }>);
      for (const h of res.hits ?? []) if (h.comment_text) comments.push(h.comment_text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 700));
    }
    const unique = [...new Set(comments)].slice(0, CONFIG.discovery.maxHnComments);
    if (!unique.length) return [];

    const prompt = `Below are job posts from Hacker News "Who is hiring". Pick companies that are B2B SaaS and whose post mentions compliance, security certification (SOC 2, ISO 27001) or hiring security/compliance/GRC people.
Return JSON array: [{ "name": string, "domain": string|null, "quote": string }] where "quote" is an exact snippet (max 160 chars) copied from the post that shows the signal, and "domain" is the company website domain if a URL appears in the post, else null. Skip posts without a clear company.

POSTS:
${unique.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`;
    const { text } = await gemini({ model: MODELS.fast(), prompt, json: true, meter });
    const parsed = parseJson<{ name: string; domain: string | null; quote: string }[]>(text);
    return parsed
      .filter((c) => c.name && c.domain && c.quote)
      .map((c) => ({
        name: c.name, domain: c.domain, quote: c.quote, url: `https://news.ycombinator.com/item?id=${id}`,
        source: "hn_hiring" as const, query: "HN Who is hiring: SOC 2 / compliance", score: strength(c.quote, 2),
      }));
  } catch (e) {
    errs.push(`hn_hiring: ${friendlyError(e)}`);
    return [];
  }
}

// ---------- Source 2: Gemini with Google Search grounding ----------
async function groundedCandidates(meter: Meter, errs: string[]): Promise<Candidate[]> {
  // Grounded searches take ~1 minute each, so run them in parallel.
  const out: Candidate[] = [];
  await Promise.all(SIGNAL_QUERIES.slice(0, CONFIG.discovery.maxGroundedQueries).map(async (query) => {
    try {
      const prompt = `Use Google Search to find up to 5 real companies matching this description: "${query}".
Prefer companies with a recent, specific public signal (a job post, a funding announcement, a blog post).
Return ONLY a JSON array: [{ "name": string, "domain": string, "quote": string, "source_url": string }]
"quote" = a short factual line describing the signal you found. "domain" = the company's own website domain. Do not invent companies.`;
      const { text } = await gemini({ model: MODELS.fast(), prompt, search: true, meter });
      const parsed = parseJson<{ name: string; domain: string; quote: string; source_url?: string }[]>(text);
      for (const c of parsed) {
        if (!c.name || !c.domain || !c.quote) continue;
        out.push({ name: c.name, domain: c.domain, quote: c.quote, url: c.source_url ?? null, source: "gemini_search", query, score: strength(c.quote, 1) });
      }
    } catch (e) {
      errs.push(`gemini_search: ${friendlyError(e)}`);
    }
  }));
  return out;
}

// ---------- Source 3: funding news (public RSS feeds) ----------
type NewsItem = { title: string; link: string; pubDate: string | null; source: string; feed: string };

export function parseRss(xml: string, feed: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const tag = (t: string) => block.match(new RegExp(`<${t}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${t}>`, "i"))?.[1]?.trim() ?? null;
    const title = tag("title");
    const link = tag("link");
    if (!title || !link) continue;
    items.push({ title: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'), link, pubDate: tag("pubDate"), source: tag("source") ?? feed, feed });
  }
  return items;
}

async function newsCandidates(meter: Meter, errs: string[], recencyDays: number): Promise<Candidate[]> {
  const all: NewsItem[] = [];
  await Promise.all(NEWS_FEEDS.map(async (f) => {
    try {
      const res = await fetch(f.url, { headers: { "user-agent": CONFIG.scrape.userAgent }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return;
      all.push(...parseRss(await res.text(), f.label).slice(0, 12));
    } catch (e) {
      errs.push(`news ${f.label}: ${String((e as Error).message).slice(0, 80)}`);
    }
  }));
  const cutoff = Date.now() - recencyDays * 86_400_000;
  const fresh = all.filter((i) => !i.pubDate || Date.parse(i.pubDate) >= cutoff);
  const seen = new Set<string>();
  const items = fresh.filter((i) => { const k = i.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  if (!items.length) return [];

  try {
    const prompt = `Below are news headlines about funding rounds. Pick those where the company that RAISED money sells B2B software (SaaS, developer tools, fintech or health software sold to businesses). Skip consumer apps, hardware, biotech, crypto, agencies, and non-funding news.
Return JSON array: [{ "i": number, "name": string, "stage": string|null, "amount": string|null }] where "i" is the headline number, "name" is the company that raised, "stage" like "Series A" if stated.

HEADLINES:
${items.map((it, i) => `[${i}] ${it.title}`).join("\n")}`;
    const { text } = await gemini({ model: MODELS.fast(), prompt, json: true, meter });
    const parsed = parseJson<{ i: number; name: string; stage: string | null; amount: string | null }[]>(text);
    const out: Candidate[] = [];
    for (const p of parsed) {
      const it = items[p.i];
      if (!it || !p.name) continue;
      out.push({
        name: p.name, domain: null, quote: it.title, url: it.link, source: "funding_news", query: it.feed, score: 1.5,
        stage: p.stage, published_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
      });
    }
    return out;
  } catch (e) {
    errs.push(`news extraction: ${friendlyError(e)}`);
    return [];
  }
}

// A funding headline has a company name but no website. Try obvious domains and VERIFY the homepage matches the name.
export async function resolveDomain(name: string): Promise<string | null> {
  const slug = name.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|technologies|labs|software|the|ai)\b/g, "").replace(/[^a-z0-9]/g, "");
  if (slug.length < 3) return null;
  for (const tld of ["com", "ai", "io", "co", "app", "dev"]) {
    const domain = `${slug}.${tld}`;
    try {
      const home = await getPage(`https://${domain}/`);
      if (nameMatches(name, domain, home.text)) return domain;
    } catch { /* not a site we can read, try the next */ }
  }
  return null;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export type DiscoverResult = {
  found: number; added: number; queuedIds: number[]; unresolved: number; alreadySeen: number;
  rejected: { domain: string; why: string }[]; sourceErrors: string[];
};

export async function discover(): Promise<DiscoverResult> {
  const { config: icp } = await getIcp();
  const meter = new Meter(400_000);
  const sourceErrors: string[] = [];
  const [hn, grounded, news] = await Promise.all([
    hnCandidates(meter, sourceErrors),
    groundedCandidates(meter, sourceErrors),
    newsCandidates(meter, sourceErrors, icp.fundingRecencyDays),
  ]);
  const raw = [...hn, ...grounded, ...news];
  const rejected: { domain: string; why: string }[] = [];
  const blocklist = new Set(icp.competitors.map((c) => c.toLowerCase()));

  // resolve websites for news candidates (verified), in parallel
  const resolved = await pool(raw, 6, async (c) => {
    if (c.domain) return { ...c, domain: normalizeDomain(c.domain) ?? null, unresolvedReason: normalizeDomain(c.domain) ? null : "invalid_domain" };
    const d = await resolveDomain(c.name);
    return { ...c, domain: d, unresolvedReason: d ? null : "website_not_verified" };
  });

  // keep the strongest signal per domain
  const byKey = new Map<string, (typeof resolved)[number]>();
  for (const c of resolved) {
    if (c.domain && (isBlockedCompany(c.domain) || blocklist.has(c.domain))) { rejected.push({ domain: c.domain, why: "competitor_or_too_big" }); continue; }
    const key = c.domain ?? `news:${c.name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || c.score > prev.score) byKey.set(key, c);
  }

  // validate: the domain must load and the homepage must match the claimed name
  const entries = [...byKey.values()];
  const checked = await pool(entries, 5, async (c) => {
    if (!c.domain || c.source === "funding_news") return c; // news domains were already verified in resolveDomain
    try {
      const home = await getPage(`https://${c.domain}/`);
      if (!nameMatches(c.name, c.domain, home.text)) return { ...c, domain: null, unresolvedReason: "name_mismatch" };
    } catch (e) {
      return { ...c, domain: null, unresolvedReason: e instanceof FetchError ? e.reason : "unreachable" };
    }
    return c;
  });

  let added = 0, unresolved = 0, alreadySeen = 0;
  for (const c of checked) {
    const dkey = c.domain ?? `name:${c.name.toLowerCase()}`;
    if (c.domain) {
      const seen = await q("SELECT 1 FROM companies WHERE domain=$1 AND (researched_at IS NULL OR researched_at > now() - ($2 || ' days')::interval) AND status <> 'failed'", [c.domain, String(icp.rerunDays)]);
      if (seen.length) { alreadySeen++; continue; }
    } else {
      rejected.push({ domain: c.name, why: c.unresolvedReason ?? "unresolved" });
    }
    const status = c.domain ? "new" : "unresolved";
    const r = await q<{ id: number }>(
      `INSERT INTO candidates (dkey, name, domain, source, signal, url, stage, published_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dkey) DO NOTHING RETURNING id`,
      [dkey, c.name, c.domain, c.source, c.quote, c.url, c.stage ?? null, c.published_at ?? null, status],
    );
    if (r.length) { if (c.domain) added++; else unresolved++; } else alreadySeen++;
  }

  const queuedIds = (await getAutoQueue()) ? await queueNew(icp.discoveryDailyCap, CONFIG.discovery.maxCandidatesPerRun, icp.sourcePriority) : [];
  await logStep(null, "discovery_run", { found: raw.length, added, unresolved, alreadySeen, queued: queuedIds.length, rejected: rejected.slice(0, 30), sourceErrors, tokens: meter.used }, meter.used);
  return { found: raw.length, added, queuedIds, unresolved, alreadySeen, rejected, sourceErrors };
}

// Turn resolved, unseen candidates into queued companies (respects the daily cap).
export async function queueNew(dailyCap: number, perRun: number, priority: string[] = ["hn_hiring", "gemini_search", "funding_news"]): Promise<number[]> {
  const today = await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM candidates WHERE status='queued' AND created_at::date = now()::date");
  const room = Math.max(0, Math.min(perRun, dailyCap - (today[0]?.n ?? 0)));
  if (room === 0) return [];
  const rows = await q<{ id: number }>(
    `SELECT id FROM candidates WHERE status='new' AND domain IS NOT NULL
     ORDER BY COALESCE(array_position($2::text[], source), 99), created_at LIMIT $1`, [room, priority],
  );
  const ids: number[] = [];
  for (const r of rows) { const cid = await queueCandidate(r.id); if (cid) ids.push(cid); }
  return ids;
}

export async function queueCandidate(candidateId: number, actor = "system"): Promise<number | null> {
  const c = (await q<{ id: number; name: string; domain: string | null; source: string; signal: string | null; url: string | null; stage: string | null; published_at: string | null; status: string }>(
    "SELECT * FROM candidates WHERE id=$1", [candidateId]))[0];
  if (!c || !c.domain || c.status === "queued") return null;
  const row = await q<{ id: number }>(
    `INSERT INTO companies (domain, name, status, source, discovery) VALUES ($1,$2,'queued',$3,$4)
     ON CONFLICT (domain) DO UPDATE SET status='queued', source=$3, discovery=$4, name=$2, updated_at=now() RETURNING id`,
    [c.domain, c.name, c.source, JSON.stringify({ source: c.source, quote: c.signal, url: c.url, stage: c.stage, published_at: c.published_at })],
  );
  await q("UPDATE candidates SET status='queued', company_id=$2 WHERE id=$1", [candidateId, row[0].id]);
  await logStep(row[0].id, "discovery", { source: c.source, quote: c.signal, url: c.url, stage: c.stage, published_at: c.published_at });
  if (actor !== "system") await audit(actor, "queue candidate", { candidate: candidateId, company: row[0].id });
  return row[0].id;
}
