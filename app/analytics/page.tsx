"use client";

import { PageHead, useApi } from "@/components/ui";

type Resp = {
  metrics: { minutesPerCompany: number; rewriteRate: number | null; sent: number; editedSent: number; pocAccuracy: number | null; autoAccepted: number; overridden: number; needsHumanRate: number; costPerCompany: number; avgFetches: number; loopCapHits: number; loopCap: number; unapprovedSent: number };
  funnel: { label: string; n: number }[];
  dropped: { reason: string; n: number }[];
  bySource: { label: string; total: number; qualified: number }[];
  verdicts: { status: string; n: number }[];
  kill: string[];
};

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ok" | "bad" | "warn" }) {
  return <div className={`kpi ${tone ?? ""}`}><div className="label">{label}</div><div className="value">{value}</div><div className="note">{note}</div></div>;
}

export default function Analytics() {
  const { data, error } = useApi<Resp>("/api/analytics");
  const m = data?.metrics;
  const top = data?.funnel[0]?.n || 1;
  const maxDrop = Math.max(1, ...(data?.dropped ?? []).map((d) => d.n));

  return (
    <>
      <PageHead title="Analytics" sub="The success measures and kill criteria we wrote down before building." />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        {data && data.kill.length > 0 && <div className="banner bad"><b>Kill criterion reached:</b> {data.kill.join(" · ")}. Per the pre-build decisions, shut it down.</div>}
        {m && (
          <div className="grid kpis">
            <Kpi label="Minutes per company" value={m.minutesPerCompany.toFixed(1)} tone={m.minutesPerCompany < 2 ? "ok" : "warn"} note={`${m.minutesPerCompany < 2 ? "on target" : "above target"} · target < 2 · manual 15-20`} />
            <Kpi label="Rewrite rate" value={m.rewriteRate == null ? "-" : `${m.rewriteRate}%`} tone={m.rewriteRate == null ? undefined : m.rewriteRate < 20 ? "ok" : m.rewriteRate > 50 ? "bad" : "warn"} note={`target < 20% · kill > 50% · ${m.sent} sent`} />
            <Kpi label="Contact accuracy" value={m.pocAccuracy == null ? "-" : `${m.pocAccuracy}%`} tone={m.pocAccuracy == null ? undefined : m.pocAccuracy >= 60 ? "ok" : "bad"} note={`${m.autoAccepted} auto-accepted, ${m.overridden} overridden · kill < 60%`} />
            <Kpi label="Needs-human rate" value={`${m.needsHumanRate}%`} tone={m.needsHumanRate < 15 ? "ok" : "warn"} note="target < 15%" />
            <Kpi label="Cost per company" value={`$${m.costPerCompany.toFixed(4)}`} note="LLM tokens, all steps (estimate)" />
            <Kpi label="Avg fetches" value={String(m.avgFetches)} note={`beyond homepage · cap ${m.loopCap}`} />
            <Kpi label="Loop cap hits" value={String(m.loopCapHits)} tone={m.loopCapHits ? "warn" : "ok"} note="sent to a human" />
            <Kpi label="Sent" value={String(m.sent)} tone="ok" note={m.unapprovedSent === 0 ? "every one approved" : "check approvals"} />
          </div>
        )}

        <div className="split" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <h2>Funnel</h2>
            <div className="card funnel">
              {data?.funnel.map((f) => (
                <div className="rowf" key={f.label}><span>{f.label}</span><div className="bar"><span style={{ width: `${Math.min(100, (f.n / top) * 100)}%` }} /></div><span className="muted small">{f.n} · {Math.round((f.n / top) * 100)}%</span></div>
              ))}
            </div>
            <h2>Verdicts</h2>
            <div className="card small">{data?.verdicts.map((v) => <span key={v.status} className="pill" style={{ marginRight: 8 }}>{v.status.replace(/_/g, " ")} {v.n}</span>)}</div>
          </div>
          <div>
            <h2>Why companies were dropped</h2>
            <div className="card funnel">
              {(data?.dropped ?? []).length === 0 && <span className="muted">Nothing dropped yet.</span>}
              {data?.dropped.map((d) => (
                <div className="rowf" key={d.reason} style={{ gridTemplateColumns: "170px 1fr 40px" }}><span>{d.reason.replace(/_/g, " ")}</span><div className="bar"><span style={{ width: `${(d.n / maxDrop) * 100}%` }} /></div><b>{d.n}</b></div>
              ))}
            </div>
            <h2>Qualification rate by source</h2>
            <div className="card">
              {data?.bySource.map((s) => (
                <div className="row" key={s.label} style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #ece9fb" }}>
                  <span>{s.label}</span><span><b>{s.qualified}/{s.total}</b> <span className="muted">· {s.total ? Math.round((s.qualified / s.total) * 100) : 0}%</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
