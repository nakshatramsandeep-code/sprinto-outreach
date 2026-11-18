import { CONFIG } from "./config";

// "https://www.Acme.io/pricing" -> "acme.io". Returns null if it is not a usable public domain.
export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0].split(":")[0].replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  if (isPrivateHost(s)) return null;
  return s;
}

// SSRF guard: discovery output comes from the internet, so never fetch internal addresses.
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  if (h.includes(":")) return true; // block raw IPv6 literals
  return false;
}

export function isBlockedCompany(domain: string): string | null {
  if (CONFIG.icp.competitors.includes(domain as never)) return "competitor";
  if (CONFIG.icp.bigCompanyBlocklist.includes(domain as never)) return "too_big";
  return null;
}

// Does the page really belong to the company the search claimed? Cheap anti-hallucination check.
export function nameMatches(claimedName: string, domain: string, pageText: string): boolean {
  const text = pageText.toLowerCase();
  const root = domain.split(".")[0];
  const tokens = claimedName
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|technologies|labs|software|the)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return text.includes(root);
  return tokens.some((t) => text.includes(t)) || (root.length >= 4 && text.includes(root));
}
