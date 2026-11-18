import { CONFIG, MODELS } from "./config";
import { q, logStep } from "./db";
import { gemini, parseJson, Meter } from "./gemini";
import { getPage, FetchError } from "./fetcher";
import { normalizeDomain, isBlockedCompany, nameMatches } from "./domain";

export type Candidate = {
  name: string;
  domain: string;
  quote: string;
  url: string | null;
  source: "hn_hiring" | "gemini_search";
  query: string;
  score: number;
};

// Signals that mean "compliance pressure". Each becomes a search.
const SIGNAL_QUERIES = [
  "B2B SaaS startup hiring a first compliance manager or GRC lead, Series A or Series B",
  "SaaS company hiring security engineer and preparing for SOC 2 audit",
  "B2B SaaS startup announces Series B funding and enterprise customers, needs security certification",
  "SaaS company working towards SOC 2 or ISO 27001 certification, no certification yet",
  "SaaS startup hiring head of security to answer enterprise security questionnaires",
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
        name: c.name,
        domain: c.domain as string,
        quote: c.quote,
        url: `https://news.ycombinator.com/item?id=${id}`,
        source: "hn_hiring" as const,
        query: "HN Who is hiring: SOC 2 / compliance",
        score: strength(c.quote, 2),
      }));
  } catch (e) {
    errs.push(`hn_hiring: ${String((e as Error).message).slice(0, 160)}`); // a failing source must not stop the run, but must be visible
    return [];
  }
}

// ---------- Source 2: Gemini with Google Search grounding ----------
async function groundedCandidates(meter: Meter, errs: string[]): Promise<Candidate[]> {
  // Grounded searches take ~1 minute each, so run them in parallel instead of one after another.
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
      errs.push(`gemini_search: ${String((e as Error).message).slice(0, 160)}`); // one bad query must not stop discovery
    }
  }));
  return out;
}

export type DiscoverResult = { companyIds: number[]; considered: number; rejected: { domain: string; why: string }[]; sourceErrors: string[] };

export async function discover(): Promise<DiscoverResult> {
  const meter = new Meter();
  const sourceErrors: string[] = [];
  const [hn, grounded] = await Promise.all([hnCandidates(meter, sourceErrors), groundedCandidates(meter, sourceErrors)]);
  const raw = [...hn, ...grounded];
  const rejected: { domain: string; why: string }[] = [];

  // normalise + dedupe, keep the strongest signal per domain
  const byDomain = new Map<string, Candidate>();
  for (const c of raw) {
    const d = normalizeDomain(c.domain);
    if (!d) { rejected.push({ domain: c.domain, why: "invalid_domain" }); continue; }
    const blocked = isBlockedCompany(d);
    if (blocked) { rejected.push({ domain: d, why: blocked }); continue; }
    const prev = byDomain.get(d);
    if (!prev || c.score > prev.score) byDomain.set(d, { ...c, domain: d });
  }

  // drop what we already researched recently
  const domains = [...byDomain.keys()];
  const known = domains.length
    ? await q<{ domain: string }>(
        "SELECT domain FROM companies WHERE domain = ANY($1) AND (researched_at IS NULL OR researched_at > now() - interval '7 days') AND status <> 'failed'",
        [domains],
      )
    : [];
  const knownSet = new Set(known.map((k) => k.domain));

  const ranked = [...byDomain.values()].filter((c) => !knownSet.has(c.domain)).sort((a, b) => b.score - a.score);

  const companyIds: number[] = [];
  for (const c of ranked) {
    if (companyIds.length >= CONFIG.discovery.maxCandidatesPerRun) break;
    // GUARDRAIL: the domain must load and the homepage must match the claimed name.
    try {
      const home = await getPage(`https://${c.domain}/`);
      if (!nameMatches(c.name, c.domain, home.text)) { rejected.push({ domain: c.domain, why: "name_mismatch" }); continue; }
    } catch (e) {
      rejected.push({ domain: c.domain, why: e instanceof FetchError ? e.reason : "unreachable" });
      continue;
    }
    const row = await q<{ id: number }>(
      `INSERT INTO companies (domain, name, status, discovery) VALUES ($1,$2,'queued',$3)
       ON CONFLICT (domain) DO UPDATE SET status='queued', discovery=$3, name=$2, updated_at=now()
       RETURNING id`,
      [c.domain, c.name, JSON.stringify({ source: c.source, query: c.query, quote: c.quote, url: c.url, score: c.score })],
    );
    companyIds.push(row[0].id);
    await logStep(row[0].id, "discovery", { source: c.source, query: c.query, quote: c.quote, url: c.url, score: c.score });
  }
  await logStep(null, "discovery_run", { found: raw.length, kept: companyIds.length, rejected, sourceErrors, tokens: meter.used }, meter.used);
  return { companyIds, considered: raw.length, rejected, sourceErrors };
}
