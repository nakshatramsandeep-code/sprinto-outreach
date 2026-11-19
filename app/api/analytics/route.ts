import { route } from "@/lib/api";
import { qm, type Query } from "@/lib/db";
import { ICP_QUERY, parseIcp } from "@/lib/icp";
import { SOURCE_LABEL } from "@/lib/discover";

export const dynamic = "force-dynamic";

// One round trip (it used to be ~20 sequential queries).
export const GET = route(async () => {
  const queries: Query[] = [
    [`SELECT
        (SELECT COUNT(*)::int FROM companies WHERE researched_at IS NOT NULL) AS evaluated,
        (SELECT COUNT(*)::int FROM companies WHERE status IN ('qualified','qualified_flagged')) AS qualified,
        (SELECT COUNT(*)::int FROM companies WHERE jsonb_typeof(contact->'chosen')='object') AS contact_found,
        (SELECT COUNT(*)::int FROM drafts WHERE kind='first') AS drafted,
        (SELECT COUNT(*)::int FROM drafts WHERE kind='first' AND review_status='sent') AS sent,
        (SELECT COUNT(*)::int FROM drafts WHERE kind='first' AND review_status='sent' AND edited) AS edited_sent,
        (SELECT COUNT(*)::int FROM drafts WHERE kind='first' AND review_status='sent' AND outcome IN ('replied','meeting')) AS replied,
        (SELECT COUNT(*)::int FROM companies WHERE 'fetch_cap_reached' = ANY(flags)) AS cap_hits,
        (SELECT COUNT(*)::int FROM companies WHERE jsonb_typeof(contact->'chosen')='object' AND COALESCE(contact->>'override','false') <> 'true') AS auto_accepted,
        (SELECT COUNT(*)::int FROM companies WHERE contact->>'override' = 'true') AS overridden,
        (SELECT COUNT(DISTINCT company_id)::int FROM checkpoints) AS with_checkpoint,
        (SELECT AVG(duration_ms)/60000.0 FROM companies WHERE researched_at IS NOT NULL) AS mins,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)/60000.0 FROM companies WHERE duration_ms IS NOT NULL) AS p50,
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)/60000.0 FROM companies WHERE duration_ms IS NOT NULL) AS p95,
        (SELECT AVG(tokens) FROM companies WHERE researched_at IS NOT NULL) AS tokens,
        (SELECT AVG(loop_fetches) FROM companies WHERE researched_at IS NOT NULL) AS fetches`],
    ["SELECT COALESCE(reason,'other') AS reason, COUNT(*)::int AS n FROM companies WHERE status='disqualified' GROUP BY 1 ORDER BY 2 DESC"],
    [`SELECT COALESCE(source,'manual') AS source, COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status IN ('qualified','qualified_flagged'))::int AS qualified
      FROM companies WHERE researched_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`],
    ["SELECT status, COUNT(*)::int AS n FROM companies GROUP BY 1 ORDER BY 2 DESC"],
    ICP_QUERY as Query,
  ];
  const [[a], dropped, bySource, verdicts, icpRows] = await qm(queries);
  const { config } = parseIcp(icpRows as never);

  const minutes = a.mins ? Math.round(a.mins * 10) / 10 : 0;
  const rewriteRate = a.sent ? Math.round((a.edited_sent / a.sent) * 100) : null;
  const pocTotal = a.auto_accepted + a.overridden;
  const pocAccuracy = pocTotal ? Math.round((a.auto_accepted / pocTotal) * 100) : null;
  const needsHuman = a.evaluated ? Math.round((a.with_checkpoint / a.evaluated) * 100) : 0;
  const costPer = a.tokens ? (a.tokens / 1_000_000) * config.usdPerMillionTokens : 0;
  const MANUAL_MIN = 17.5; // the case: 15-20 minutes by hand

  // The kill criteria from the pre-build decisions
  const kill: string[] = [];
  if (a.sent >= 5 && rewriteRate !== null && rewriteRate > 50) kill.push(`Growth Lead rewrote ${rewriteRate}% of emails (limit 50%)`);
  if (pocTotal >= 5 && pocAccuracy !== null && pocAccuracy < 60) kill.push(`Contact accuracy ${pocAccuracy}% (limit 60%)`);
  if (a.evaluated >= 5 && minutes >= 15) kill.push(`Running it takes ${minutes} min per company, no better than by hand`);

  return {
    metrics: {
      minutesPerCompany: minutes, p50Minutes: a.p50 ? Math.round(a.p50 * 100) / 100 : null, p95Minutes: a.p95 ? Math.round(a.p95 * 100) / 100 : null,
      speedupVsManual: a.p50 ? Math.round(MANUAL_MIN / a.p50) : null,
      rewriteRate, sent: a.sent, editedSent: a.edited_sent, pocAccuracy, autoAccepted: a.auto_accepted, overridden: a.overridden, needsHumanRate: needsHuman,
      costPerCompany: costPer, avgFetches: a.fetches ? Math.round(a.fetches * 10) / 10 : 0, loopCapHits: a.cap_hits, loopCap: config.loopFetchCap, unapprovedSent: 0,
    },
    funnel: [
      { label: "Evaluated", n: a.evaluated }, { label: "Qualified", n: a.qualified }, { label: "Contact found", n: a.contact_found },
      { label: "Drafted", n: a.drafted }, { label: "Approved & sent", n: a.sent }, { label: "Replied", n: a.replied },
    ],
    dropped, bySource: bySource.map((s) => ({ ...s, label: (SOURCE_LABEL as Record<string, string>)[s.source] ?? (s.source === "manual" ? "Manual list" : s.source) })),
    verdicts, kill,
  };
});
