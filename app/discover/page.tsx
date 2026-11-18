"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { PageHead, useApi, useRunner, LogBox, Toggle, ago } from "@/components/ui";

type Cand = { id: number; name: string; domain: string | null; source: string; signal: string | null; url: string | null; stage: string | null; published_at: string | null; status: string; company_id: number | null; created_at: string };
type Resp = { items: Cand[]; foundToday: number; waiting: number; queuedTotal: number; autoQueue: boolean; sources: Record<string, string> };

export default function Discover() {
  const { data, reload, error } = useApi<Resp>("/api/candidates");
  const { busy, log, run } = useRunner(reload);
  const [tab, setTab] = useState("new");
  const items = (data?.items ?? []).filter((c) => tab === "all" || (tab === "new" ? ["new", "unresolved"].includes(c.status) : c.status === tab));
  const n = (t: string) => (data?.items ?? []).filter((c) => t === "all" || (t === "new" ? ["new", "unresolved"].includes(c.status) : c.status === t)).length;

  async function queue(id: number) {
    try { await api(`/api/candidates/${id}/queue`, { method: "POST", body: {} }); } catch {}
    reload();
  }
  async function toggle(v: boolean) { await api("/api/settings", { body: { autoQueue: v } }); reload(); }

  return (
    <>
      <PageHead title="Discover" sub="Companies found from hiring posts, web search and funding news. A site is only used once its homepage is verified."
        right={<><button onClick={() => run("discover")} disabled={busy}>{busy ? "Discovering..." : "Discover now"}</button><button className="ghost" onClick={() => run("process")} disabled={busy}>Research queued</button></>} />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        <LogBox log={log} />
        <div className="grid kpis">
          <div className="kpi"><div className="label">Found today</div><div className="value">{data?.foundToday ?? "-"}</div></div>
          <div className="kpi"><div className="label">Waiting to queue</div><div className="value">{data?.waiting ?? "-"}</div></div>
          <div className="kpi"><div className="label">Queued so far</div><div className="value">{data?.queuedTotal ?? "-"}</div></div>
          <div className="kpi"><div className="label">Auto-queue discovered</div><div style={{ marginTop: 8 }}><Toggle on={!!data?.autoQueue} onChange={toggle} label={data?.autoQueue ? "On" : "Off"} /></div><div className="note">New finds with a verified site go straight to research</div></div>
        </div>

        <div className="tabs" style={{ marginTop: 16 }}>
          {[["new", "New"], ["queued", "Queued"], ["all", "All"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}<span className="n">{n(k)}</span></button>)}
        </div>
        <div className="card" style={{ padding: 0 }}>
          {items.length === 0 && <div className="item muted" style={{ padding: 14 }}>Nothing here. Press Discover now.</div>}
          {items.map((c) => (
            <div key={c.id} className="row" style={{ padding: "12px 16px", borderBottom: "1px solid #ece9fb", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <b>{c.name}</b> {c.domain ? <span className="muted small">{c.domain}</span> : <span className="pill warn">website not verified</span>}
                <div className="small muted">{c.signal} {c.url && <a href={c.url} target="_blank" rel="noreferrer">source</a>}</div>
              </div>
              <span className="pill">{data?.sources[c.source] ?? c.source}</span>
              {c.stage && <span className="pill">{c.stage}</span>}
              <span className="muted small nowrap">{ago(c.published_at ?? c.created_at)}</span>
              {c.status === "queued" && c.company_id ? <Link className="btn ghost" href={`/accounts/${c.company_id}`}>Queued · open</Link>
                : c.domain ? <button className="ghost" onClick={() => queue(c.id)}>Queue</button> : <span className="muted small">unresolved</span>}
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
