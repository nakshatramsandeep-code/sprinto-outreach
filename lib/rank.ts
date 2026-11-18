// Choose the right person, not "the nearest manager". Pure functions, easy to test.

export type HunterPerson = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  confidence: number | null;
  verified: boolean;
};

export type Ranked = HunterPerson & { score: number; why: string[] };

const SECURITY = /\b(ciso|chief information security|security|compliance|grc|risk|trust|privacy)\b/i;
const TECH_LEAD = /\b(cto|chief technology|vp (of )?engineering|head of engineering|vp eng|engineering lead)\b/i;
const FOUNDER = /\b(founder|co-founder|ceo|chief executive|coo|chief operating)\b/i;
const JUNIOR = /\b(intern|assistant|associate|junior|student|recruit|sales|marketing|support|customer success)\b/i;

export function scorePerson(p: HunterPerson, smallCompany: boolean): Ranked {
  const why: string[] = [];
  let score = 0;
  const title = p.position ?? "";
  const lead = p.seniority === "executive" || p.seniority === "senior" || /\b(head|chief|vp|director|lead|founder)\b/i.test(title);

  if (SECURITY.test(title) && lead) { score += 60; why.push("security/compliance leader"); }
  else if (SECURITY.test(title)) { score += 35; why.push("security/compliance role"); }
  else if (TECH_LEAD.test(title)) { score += smallCompany ? 45 : 30; why.push("technology leader"); }
  else if (FOUNDER.test(title)) { score += smallCompany ? 45 : 20; why.push("founder/executive"); }

  if (JUNIOR.test(title)) { score -= 40; why.push("junior or non-buyer role"); }
  if (p.seniority === "executive") { score += 10; why.push("executive seniority"); }
  if (p.verified) { score += 10; why.push("email verified"); }
  score += Math.round((p.confidence ?? 0) / 10); // 0-10 pts
  return { ...p, score, why };
}

export const MIN_CONTACT_SCORE = 35;
export const BEST_MATCH_FLOOR = 20; // below this there is no sensible "best match" to suggest

// chosen = clears the auto-accept bar. best = the top candidate even if it does not (a human can confirm it).
export function pickContact(
  people: HunterPerson[],
  smallCompany: boolean,
  autoAccept: number = MIN_CONTACT_SCORE,
): { chosen: Ranked | null; best: Ranked | null; ranked: Ranked[] } {
  const ranked = people
    .filter((p) => p.email && p.first_name && p.position) // need a real name and a role
    .map((p) => scorePerson(p, smallCompany))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  return {
    chosen: top && top.score >= autoAccept ? top : null,
    best: top && top.score >= BEST_MATCH_FLOOR ? top : null,
    ranked: ranked.slice(0, 5),
  };
}
