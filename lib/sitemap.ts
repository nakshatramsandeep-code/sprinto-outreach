import { q } from "./db";
import { fetchRaw, sitemapsFor } from "./fetcher";
import { TOPIC_PATHS, isTopicSegment } from "./clean";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#38;/g, "&");
const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));

// Pure: sitemap XML -> page URLs (or child sitemaps if it is an index).
export function parseSitemap(xml: string): { urls: string[]; children: string[] } {
  const all = locs(xml);
  return /<sitemapindex/i.test(xml) ? { urls: [], children: all } : { urls: all, children: [] };
}

// Pure: choose the URLs on the same site that look like a topic page (security, careers, ...).
export function pickFromSitemap(urls: string[], base: string, topic: keyof typeof TOPIC_PATHS): string[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const kws = TOPIC_PATHS[topic].keywords;
  const hits: { url: string; score: number }[] = [];
  for (const raw of urls) {
    try {
      const u = new URL(raw);
      if (u.hostname.replace(/^www\./, "") !== host) continue;
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length === 0 || segs.length > 2) continue; // top-level pages only, skip blog posts etc.
      const idx = kws.findIndex((k) => isTopicSegment(segs[0], k));
      if (idx < 0) continue;
      hits.push({ url: u.origin + u.pathname, score: idx * 10 + segs.length });
    } catch {}
  }
  return [...new Set(hits.sort((a, b) => a.score - b.score).map((h) => h.url))];
}

/**
 * Load a site's sitemap URLs (capped). Cached 7 days in the pages table. Returns [] if none or disallowed.
 * Cost: 1-3 polite requests, and only for companies whose loop actually needs another page.
 */
export async function loadSitemapUrls(domain: string): Promise<string[]> {
  const key = `sitemap:${domain}`;
  const cached = await q<{ text: string }>("SELECT text FROM pages WHERE url=$1 AND fetched_at > now() - interval '7 days'", [key]);
  if (cached[0]) return cached[0].text ? cached[0].text.split("\n") : [];

  const origin = `https://${domain}`;
  let urls: string[] = [];
  try {
    const declared = await sitemapsFor(origin);
    const roots = declared.length ? declared.slice(0, 2) : [`${origin}/sitemap.xml`];
    const queue = [...roots];
    let fetches = 0;
    while (queue.length && fetches < 3 && urls.length < 2000) {
      const next = queue.shift() as string;
      if (/\.gz$/i.test(next)) continue; // compressed sitemaps are skipped to keep this simple
      fetches++;
      const xml = await fetchRaw(next);
      if (!xml) continue;
      const parsed = parseSitemap(xml);
      urls.push(...parsed.urls);
      // index file: prefer child sitemaps that look like general pages, not blog/news
      const kids = parsed.children.filter((c) => !/blog|news|post|article|changelog|product-?s?-/i.test(c));
      queue.push(...kids.slice(0, 2));
    }
  } catch {
    urls = []; // robots disallow or network trouble: simply no sitemap
  }
  urls = [...new Set(urls)].slice(0, 2000);
  await q(
    `INSERT INTO pages (url, text, links, method, word_count) VALUES ($1,$2,'[]','sitemap',$3)
     ON CONFLICT (url) DO UPDATE SET text=$2, word_count=$3, fetched_at=now()`,
    [key, urls.join("\n"), urls.length],
  );
  return urls;
}
