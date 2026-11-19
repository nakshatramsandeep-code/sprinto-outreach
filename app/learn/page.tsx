"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { PageHead, useApi } from "@/components/ui";

type Row = { key: string; n: number; replied: number; rate: number };
type Resp = {
  version: number; dismissedCount: number;
  stats: {
    coverage: { sent: number; outcomes: number; replied: number; edited: number; contactDecisions: number; overrides: number; maybeDecisions: number; needs: string[] };
    replyBy: { tier: Row[]; source: Row[]; hook: Row[]; edited: Row[] };
    edits: { topRemoved: { phrase: string; drafts: number }[]; avgLengthRatio: number | null };
    contacts: { reasons: { reason: string; n: number }[]; overrideRate: number | null };
  };
  suggestions: { id: string; kind: string; title: string; why: string; evidence: string[]; patch: unknown | null; confidence: "low" | "medium" }[];
  min: Record<string, number>;
};

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="card">
      <b>{title}</b>
      {rows.length === 0 ? <div className="muted small">No outcomes recorded yet.</div> : rows.map((r) => (
        <div className="row" key={r.key} style={{ justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #ece9fb", flexWrap: "nowrap", alignItems: "flex-start" }}>
          <span>{r.key}</span><span><b>{r.rate}%</b> <span className="muted small">({r.replied}/{r.n}){r.n < 5 ? " · too few to trust" : ""}</span></span>
        </div>
      ))}
    </div>
  );
}

export default function Learning() {
  const { data, reload, error } = useApi<Resp>("/api/learning");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const c = data?.stats.coverage;

  async function act(id: string, dismiss: boolean) {
    setBusy(id); setMsg("");
    try {
      const r = await api<{ version?: number }>("/api/learning/apply", { body: { id, dismiss } });
      setMsg(dismiss ? "Dismissed." : `Applied as ICP v${r.version}. It is reversible on the ICP & Rules page. Run the evals to check nothing got worse.`);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(""); reload();
  }

  return (
    <>
      <PageHead title="Learning" sub="How your edits, overrides and replies turn into suggested rule changes. Nothing changes until you press Apply." />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        {msg && <div className="banner warn">{msg}</div>}

        <div className="card small">
          <b>How the loop works</b> · 1. You work: edit drafts, confirm or replace contacts, answer maybe-band items, mark replies. · 2. The system records each decision. · 3. Rules below look for patterns, but only with enough data. · 4. You Apply a suggestion: it saves a <i>new, reversible</i> ICP version and is logged. · 5. Run the <Link href="/evals">evals</Link> to confirm quality did not drop.
        </div>

        <h2>Signals collected</h2>
        <div className="grid kpis">
          <div className="kpi"><div className="label">Emails sent</div><div className="value">{c?.sent ?? "-"}</div></div>
          <div className="kpi"><div className="label">With an outcome</div><div className="value">{c?.outcomes ?? "-"}</div><div className="note">{c?.replied ?? 0} replied or met</div></div>
          <div className="kpi"><div className="label">Edited before sending</div><div className="value">{c?.edited ?? "-"}</div></div>
          <div className="kpi"><div className="label">Contact decisions</div><div className="value">{c?.contactDecisions ?? "-"}</div><div className="note">{c?.overrides ?? 0} overrides</div></div>
          <div className="kpi"><div className="label">Maybe-band decisions</div><div className="value">{c?.maybeDecisions ?? "-"}</div></div>
        </div>
        {c && c.needs.length > 0 && <div className="card small" style={{ marginTop: 12 }}><b>Not enough data yet for:</b><ul style={{ margin: "6px 0 0" }}>{c.needs.map((n) => <li key={n}>{n}</li>)}</ul><span className="muted">Rules stay silent below these minimums so they never act on noise. Record outcomes in the Pipeline to speed this up.</span></div>}

        <h2>Suggestions</h2>
        {(data?.suggestions ?? []).length === 0 && <div className="card muted">No suggestions right now. {data?.dismissedCount ? `${data.dismissedCount} dismissed.` : ""}</div>}
        {data?.suggestions.map((s) => (
          <div className="card" key={s.id}>
            <div className="row"><b>{s.title}</b><span className={`pill ${s.confidence === "medium" ? "ok" : "warn"}`}>{s.confidence} confidence</span>{s.patch == null && <span className="pill">insight only</span>}</div>
            <div className="small muted" style={{ margin: "4px 0" }}>{s.why}</div>
            <ul className="small" style={{ margin: "6px 0 10px" }}>{s.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            <div className="row">
              {s.patch != null && <button disabled={busy === s.id} onClick={() => act(s.id, false)}>Apply as new ICP version</button>}
              <button className="ghost" disabled={busy === s.id} onClick={() => act(s.id, true)}>Dismiss</button>
            </div>
          </div>
        ))}

        <h2>Reply rate by group</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          <Table title="By score tier" rows={data?.stats.replyBy.tier ?? []} />
          <Table title="By discovery source" rows={data?.stats.replyBy.source ?? []} />
          <Table title="By hook used" rows={data?.stats.replyBy.hook ?? []} />
          <Table title="Edited vs sent as written" rows={data?.stats.replyBy.edited ?? []} />
        </div>

        <h2>What you change</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
          <div className="card"><b>Phrases you delete</b>
            {(data?.stats.edits.topRemoved ?? []).length === 0 ? <div className="muted small">No repeated deletions yet.</div> : data?.stats.edits.topRemoved.map((p) => <div className="small" key={p.phrase}>“{p.phrase}” <span className="muted">in {p.drafts} drafts</span></div>)}
            {data?.stats.edits.avgLengthRatio != null && <div className="small muted" style={{ marginTop: 6 }}>Edited emails end at {data.stats.edits.avgLengthRatio}% of the original length.</div>}
          </div>
          <div className="card"><b>Contact overrides</b>
            <div className="small muted">{data?.stats.contacts.overrideRate == null ? "No contact decisions yet." : `You replaced our pick in ${data.stats.contacts.overrideRate}% of cases that needed you.`}</div>
            {data?.stats.contacts.reasons.map((r) => <div className="small" key={r.reason}>{r.reason} <span className="muted">({r.n})</span></div>)}
          </div>
        </div>
      </main>
    </>
  );
}
