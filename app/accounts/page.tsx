"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHead, useApi, StatusChip, Tier, ago } from "@/components/ui";

type Row = {
  id: number; domain: string; name: string | null; status: string; reason: string | null; score: number | null; tier: string | null; source: string | null;
  flags: string[]; signal: string | null; updated_at: string; open_checkpoints: number; review_status: string | null;
};
const FILTERS = ["all", "qualified", "qualified_flagged", "maybe", "disqualified", "manual_review", "queued", "failed"];

export default function Accounts() {
  const { data, error } = useApi<{ companies: Row[]; hunter: { used: number; limit: number } }>("/api/companies");
  const [f, setF] = useState("all");
  const rows = (data?.companies ?? []).filter((r) => f === "all" || r.status === f);
  const count = (s: string) => (data?.companies ?? []).filter((r) => s === "all" || r.status === s).length;

  return (
    <>
      <PageHead title="Accounts" sub="Every company the system has looked at, with the verdict and why." />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        <div className="tabs">
          {FILTERS.map((s) => <button key={s} className={f === s ? "on" : ""} onClick={() => setF(s)}>{s.replace(/_/g, " ")}<span className="n">{count(s)}</span></button>)}
        </div>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead><tr><th>Company</th><th>Verdict</th><th className="hide-sm">Why it surfaced</th><th>Score</th><th className="hide-sm">Updated</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing here yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name ?? r.domain}</b><div className="muted small">{r.domain}</div></td>
                  <td>
                    <StatusChip status={r.status} />
                    {r.reason && <div className="muted small">{r.reason}</div>}
                    {r.open_checkpoints > 0 && <div><Link className="flag" href="/review">needs you ({r.open_checkpoints})</Link></div>}
                    <div>{r.flags?.map((x) => <span className="flag" key={x}>⚑ {x}</span>)}</div>
                  </td>
                  <td className="hide-sm small muted" style={{ maxWidth: 360 }}>{r.signal ?? "-"}</td>
                  <td><Tier tier={r.tier} score={r.score} /></td>
                  <td className="hide-sm muted small nowrap">{ago(r.updated_at)}</td>
                  <td><Link className="btn ghost" href={`/accounts/${r.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
