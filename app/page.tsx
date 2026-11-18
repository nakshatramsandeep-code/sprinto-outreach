"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, getKey, setKey } from "@/lib/client";

type Row = {
  id: number; domain: string; name: string | null; status: string; reason: string | null; rank: number | null;
  flags: string[]; signal: string | null; draft_id: number | null; review_status: string | null;
};

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hunter, setHunter] = useState<{ used: number; limit: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [key, setKeyState] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ companies: Row[]; hunter: { used: number; limit: number } }>("/api/companies");
      setRows(r.companies); setHunter(r.hunter); setError("");
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { setKeyState(getKey()); refresh(); }, [refresh]);

  async function runDiscovery() {
    setBusy(true); setLog([]);
    const say = (s: string) => setLog((l) => [...l, s]);
    try {
      say("Searching the web for companies that match the ICP...");
      const d = await api<{ companyIds: number[]; considered: number; rejected: { domain: string; why: string }[]; sourceErrors: string[] }>("/api/discover", { method: "POST", body: {} });
      say(`Found ${d.considered} candidates, kept ${d.companyIds.length}, rejected ${d.rejected.length}.`);
      d.sourceErrors?.forEach((s) => say(`  source problem: ${s}`));
      d.rejected.slice(0, 8).forEach((r) => say(`  rejected ${r.domain}: ${r.why}`));
      await refresh();
      // One company at a time, so each call stays short.
      for (const [i, id] of d.companyIds.entries()) {
        say(`Researching company ${i + 1} of ${d.companyIds.length}...`);
        try {
          const r = await api<{ status: string; reason: string | null }>("/api/run-company", { method: "POST", body: { id } });
          say(`  -> ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
        } catch (e) { say(`  -> error: ${(e as Error).message}`); }
        await refresh();
      }
      say("Done.");
    } catch (e) { setError((e as Error).message); }
    setBusy(false); refresh();
  }

  return (
    <>
    <section className="hero"><div className="wrap">
      <h1>Outreach that finds its own <span className="accent">prospects.</span></h1>
      <p>The system finds companies that fit the ICP, researches them and drafts the email. You review and send. Every email goes to your own inbox only.</p>
    </div></section>
    <main>
      <div className="card row">
        <button onClick={runDiscovery} disabled={busy}>{busy ? "Working..." : "Run discovery"}</button>
        <button className="ghost" onClick={refresh} disabled={busy}>Refresh</button>
        {hunter && <span className="muted small">Hunter searches this month: {hunter.used} / {hunter.limit}</span>}
        <span style={{ flex: 1 }} />
        <input style={{ maxWidth: 200 }} type="password" placeholder="Access key (if set)" value={key}
          onChange={(e) => { setKeyState(e.target.value); setKey(e.target.value); }} />
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          {error === "unauthorized" ? "Enter your access key in the box above, then press Refresh." : `Error: ${error}`}
        </div>
      )}
      {log.length > 0 && <div className="card small"><pre>{log.join("\n")}</pre></div>}

      <h2>Companies</h2>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr><th>Company</th><th>Status</th><th className="hide-sm">Why it surfaced</th><th>Rank</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet. Press Run discovery.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name ?? r.domain}</b><div className="muted small">{r.domain}</div></td>
                <td>
                  <span className={`chip ${r.status}`}>{r.status.replace("_", " ")}</span>
                  {r.reason && <div className="muted small">{r.reason}</div>}
                  <div>{r.flags?.map((f) => <span className="flag" key={f}>⚑ {f}</span>)}</div>
                </td>
                <td className="hide-sm small muted">{r.signal ?? "-"}</td>
                <td>{r.rank ?? "-"}</td>
                <td><Link className="btn ghost" href={`/company/${r.id}`}>Why</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
