import { route } from "@/lib/api";
import { q } from "@/lib/db";
import { getIcp } from "@/lib/icp";
import { SOURCE_LABEL } from "@/lib/discover";

export const dynamic = "force-dynamic";

const n = async (sql: string) => (await q<{ n: number }>(sql))[0]?.n ?? 0;

export const GET = route(async () => {
  const { config } = await getIcp();
  const evaluated = await n("SELECT COUNT(*)::int AS n FROM companies WHERE researched_at IS NOT NULL");
  const qualified = await n("SELECT COUNT(*)::int AS n FROM companies WHERE status IN ('qualified','qualified_flagged')");
  const contactFound = await n("SELECT COUNT(*)::int AS n FROM companies WHERE jsonb_typeof(contact->'chosen')='object'");
  const drafted = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE kind='first'");
  const sent = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE kind='first' AND review_status='sent'");
  const editedSent = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE kind='first' AND review_status='sent' AND edited");
  const replied = await n("SELECT COUNT(*)::int AS n FROM drafts WHERE kind='first' AND review_status='sent' AND outcome IN ('replied','meeting')");

  const agg = (await q<{ mins: number | null; tokens: number | null; fetches: number | null }>(
    "SELECT AVG(duration_ms)/60000.0 AS mins, AVG(tokens) AS tokens, AVG(loop_fetches) AS fetches FROM companies WHERE researched_at IS NOT NULL",
  ))[0];
  const capHits = await n("SELECT COUNT(*)::int AS n FROM companies WHERE 'fetch_cap_reached' = ANY(flags)");
  const autoAccepted = await n("SELECT COUNT(*)::int AS n FROM companies WHERE jsonb_typeof(contact->'chosen')='object' AND COALESCE(contact->>'override','false') <> 'true'");
  const overridden = await n("SELECT COUNT(*)::int AS n FROM companies WHERE contact->>'override' = 'true'");
  const withCheckpoint = await n("SELECT COUNT(DISTINCT company_id)::int AS n FROM checkpoints");
  const unapprovedSent = 0; // sending only happens through the approve action, so this is always 0

  const dropped = await q<{ reason: string; n: number }>("SELECT COALESCE(reason,'other') AS reason, COUNT(*)::int AS n FROM companies WHERE status='disqualified' GROUP BY 1 ORDER BY 2 DESC");
  const bySource = await q<{ source: string; total: number; qualified: number }>(
    `SELECT COALESCE(source,'manual') AS source, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('qualified','qualified_flagged'))::int AS qualified
     FROM companies WHERE researched_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
  );
  const verdicts = await q<{ status: string; n: number }>("SELECT status, COUNT(*)::int AS n FROM companies GROUP BY 1 ORDER BY 2 DESC");

  const minutes = agg?.mins ? Math.round(agg.mins * 10) / 10 : 0;
  const rewriteRate = sent ? Math.round((editedSent / sent) * 100) : null;
  const pocTotal = autoAccepted + overridden;
  const pocAccuracy = pocTotal ? Math.round((autoAccepted / pocTotal) * 100) : null;
  const needsHuman = evaluated ? Math.round((withCheckpoint / evaluated) * 100) : 0;
  const costPer = agg?.tokens ? (agg.tokens / 1_000_000) * config.usdPerMillionTokens : 0;

  // The kill criteria from the pre-build decisions
  const kill: string[] = [];
  if (sent >= 5 && rewriteRate !== null && rewriteRate > 50) kill.push(`Growth Lead rewrote ${rewriteRate}% of emails (limit 50%)`);
  if (pocTotal >= 5 && pocAccuracy !== null && pocAccuracy < 60) kill.push(`Contact accuracy ${pocAccuracy}% (limit 60%)`);
  if (evaluated >= 5 && minutes >= 15) kill.push(`Running it takes ${minutes} min per company, no better than by hand`);

  return {
    metrics: {
      minutesPerCompany: minutes, rewriteRate, sent, editedSent, pocAccuracy, autoAccepted, overridden, needsHumanRate: needsHuman,
      costPerCompany: costPer, avgFetches: agg?.fetches ? Math.round(agg.fetches * 10) / 10 : 0, loopCapHits: capHits, loopCap: config.loopFetchCap, unapprovedSent,
    },
    funnel: [
      { label: "Evaluated", n: evaluated }, { label: "Qualified", n: qualified }, { label: "Contact found", n: contactFound },
      { label: "Drafted", n: drafted }, { label: "Approved & sent", n: sent }, { label: "Replied", n: replied },
    ],
    dropped, bySource: bySource.map((s) => ({ ...s, label: (SOURCE_LABEL as Record<string, string>)[s.source] ?? (s.source === "manual" ? "Manual list" : s.source) })),
    verdicts, kill,
  };
});
