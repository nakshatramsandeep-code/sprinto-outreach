import { CONFIG } from "./config";
import { nameMatches } from "./domain";

// Public job-board APIs (Greenhouse, Lever, Ashby). Official, structured, free: preferred over scraping a careers page.

export type Provider = "greenhouse" | "lever" | "ashby";
export type BoardRef = { provider: Provider; token: string; fromLink: boolean };
export type JobSummary = { count: number; complianceTitles: string[] };
export type JobsFound = { provider: Provider; token: string; url: string; titles: string[] } & JobSummary;

const COMPLIANCE_RE = /\b(compliance|grc|security|privacy|risk|trust|ciso|infosec|information security|audit)\b/i;

// Pure: find job-board references in a page's links.
export function extractBoardRefs(links: { href: string }[]): BoardRef[] {
  const out: BoardRef[] = [];
  const add = (provider: Provider, token: string | undefined) => {
    const t = (token ?? "").toLowerCase();
    if (!t || ["embed", "v1", "api", "jobs"].includes(t)) return;
    if (!out.some((o) => o.provider === provider && o.token === t)) out.push({ provider, token: t, fromLink: true });
  };
  for (const { href } of links) {
    let m = href.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i);
    if (m) add("greenhouse", m[1]);
    m = href.match(/jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i);
    if (m) add("lever", m[1]);
    m = href.match(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i);
    if (m) add("ashby", m[1]);
  }
  return out;
}

// Pure: count roles and pick out the compliance/security ones.
export function summariseJobs(titles: string[]): JobSummary {
  return { count: titles.length, complianceTitles: titles.filter((t) => COMPLIANCE_RE.test(t)).slice(0, 5) };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": CONFIG.scrape.userAgent, accept: "application/json" }, signal: AbortSignal.timeout(CONFIG.scrape.timeoutMs) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function fetchBoard(ref: BoardRef): Promise<JobsFound | null> {
  const { provider, token } = ref;
  let titles: string[] = [];
  let url = "";
  if (provider === "greenhouse") {
    url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`;
    const j = await getJson<{ jobs?: { title: string }[] }>(url);
    titles = (j?.jobs ?? []).map((x) => x.title);
  } else if (provider === "lever") {
    url = `https://api.lever.co/v0/postings/${token}?mode=json`;
    const j = await getJson<{ text: string }[]>(url);
    titles = Array.isArray(j) ? j.map((x) => x.text) : [];
  } else {
    url = `https://api.ashbyhq.com/posting-api/job-board/${token}`;
    const j = await getJson<{ jobs?: { title: string }[] }>(url);
    titles = (j?.jobs ?? []).map((x) => x.title);
  }
  titles = titles.filter(Boolean);
  if (titles.length === 0) return null;
  return { provider, token, url, titles, ...summariseJobs(titles) };
}

/**
 * Find the company's job board and return open roles.
 * Tokens come from links on the company's own pages (trusted). As a fallback we guess the Greenhouse token
 * from the domain, but only accept it if the board's declared name matches the company (avoids same-name mix-ups).
 */
export async function findJobs(domain: string, companyName: string, links: { href: string }[]): Promise<JobsFound | null> {
  const refs = extractBoardRefs(links);
  for (const ref of refs.slice(0, 3)) {
    const found = await fetchBoard(ref);
    if (found) return found;
  }
  const root = domain.split(".")[0].replace(/[^a-z0-9]/g, "");
  if (root.length >= 3 && !refs.some((r) => r.provider === "greenhouse")) {
    const meta = await getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${root}`);
    if (meta?.name && nameMatches(companyName, domain, meta.name)) {
      const found = await fetchBoard({ provider: "greenhouse", token: root, fromLink: false });
      if (found) return found;
    }
  }
  return null;
}
