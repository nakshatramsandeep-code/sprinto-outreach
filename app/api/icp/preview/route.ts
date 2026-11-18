import { route, bad, readJson } from "@/lib/api";
import { q } from "@/lib/db";
import { getIcp, validateIcp, withDefaults, type IcpConfig } from "@/lib/icp";
import { scoreCompany } from "@/lib/score";
import type { Fields } from "@/lib/fields";

export const dynamic = "force-dynamic";

// "What would change?" Re-scores every researched account with the proposed numbers. Scoring is deterministic, so no model calls.
export const POST = route(async (req) => {
  const b = await readJson<{ config?: Partial<IcpConfig> }>(req);
  if (!b.config) return bad("config required");
  const next = withDefaults(b.config);
  const problems = validateIcp(next);
  if (problems.length) return { problems, moved: [], total: 0 };
  const { config: current } = await getIcp();
  const rows = await q<{ id: number; name: string | null; domain: string; fields: Fields; discovery: Record<string, unknown> | null; flags: string[]; tier: string | null; score: number | null }>(
    "SELECT id, name, domain, fields, discovery, flags, tier, score FROM companies WHERE fields IS NOT NULL AND status NOT IN ('failed','queued','running') LIMIT 500",
  );
  const moved: { id: number; company: string; from: string; to: string; fromScore: number; toScore: number }[] = [];
  for (const r of rows) {
    if (!r.fields.compliance_hiring) r.fields.compliance_hiring = { value: null, quote: null, url: null };
    const flags = (r.flags ?? []).filter((f) => ["cert_unconfirmed", "stage_unknown"].includes(f));
    const input = { fields: r.fields, discovery: r.discovery, flags };
    const a = scoreCompany(input, current);
    const bScore = scoreCompany(input, next);
    if (a.tier !== bScore.tier) moved.push({ id: r.id, company: r.name ?? r.domain, from: a.tier, to: bScore.tier, fromScore: a.score, toScore: bScore.score });
  }
  return { problems: [], moved: moved.slice(0, 50), total: rows.length, movedCount: moved.length };
});
