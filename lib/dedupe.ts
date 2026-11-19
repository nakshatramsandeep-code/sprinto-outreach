// One company can show up under different domains (liberate.ai / liberateinc.com) or as a name-only headline plus a resolved site.
// A "name key" boils a company name (or, failing that, a domain) down to something that is the same for all of those.

const LEGAL = /\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|software|hq|group|the)\b/g;

export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // accents
    .replace(LEGAL, " ")
    .replace(/[^a-z0-9]/g, "");
}

// "liberateinc.com" -> "liberate", "www.Coval.dev" -> "coval", "juicebox.work" -> "juicebox"
export function keyFromDomain(domain: string): string {
  let root = domain.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0].split(".")[0];
  const stripped = root.replace(/(inc|hq|labs|app|co)$/, "");
  if (stripped.length >= 4) root = stripped;
  return nameKey(root);
}

// The key to store for a company: prefer its real name; fall back to its domain when the name is just the domain.
export function companyKey(name: string | null | undefined, domain: string | null | undefined): string {
  const n = (name ?? "").trim();
  const looksLikeDomain = !n || /\.[a-z]{2,}$/i.test(n) || (domain ? n.toLowerCase() === domain.toLowerCase() : false);
  if (!looksLikeDomain) return nameKey(n) || (domain ? keyFromDomain(domain) : "");
  return domain ? keyFromDomain(domain) : nameKey(n);
}
