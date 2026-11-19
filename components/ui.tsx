"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, fetchCached, peek } from "@/lib/client";

export function PageHead({ title, sub, right, back }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; back?: ReactNode }) {
  return (
    <section className="hero"><div className="wrap">
      {back}
      <div className="row">
        <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
        {right && <div className="row">{right}</div>}
      </div>
    </div></section>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${status}`}>{status.replace(/_/g, " ")}</span>;
}

export function Tier({ tier, score }: { tier?: string | null; score?: number | null }) {
  if (!tier && score == null) return <span className="muted">-</span>;
  const s = score == null ? null : Math.max(0, Math.min(100, Math.round(score))); // the scale is 0-100: never show more
  if (!tier) return <b>{s}</b>; // older accounts have a score but no tier
  return <span><span className={`tier ${tier}`}>{tier}</span> <b>{s ?? ""}</b></span>;
}

export function ago(iso?: string | null): string {
  if (!iso) return "-";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// Load JSON from an API route; reload() to refresh.
// Shows the last known data immediately (if this page was visited or prefetched) and refreshes it in the background.
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setData(await fetchCached<T>(path)); setError(""); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [path]);
  useEffect(() => {
    const cached = peek<T>(path);
    if (cached) { setData(cached); setLoading(false); }
    reload();
  }, [path, reload]);
  return { data, error, reload, setData, loading: loading && data === null && !error };
}

// Grey shimmer blocks while data is on its way (instead of "-" or a misleading "Nothing yet").
export function Skeleton({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  return <div aria-busy="true" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <div key={i} className="skel" style={{ height, width: `${92 - i * 11}%`, marginBottom: 10 }} />)}</div>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <span className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} tabIndex={0} onClick={() => onChange(!on)} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange(!on)}><i />{label}</span>;
}

// Run = find companies, then research each queued one, one at a time (each call stays short).
export function useRunner(onChange: () => void) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stop = useRef(false);

  const say = (s: string) => setLog((l) => [...l, s]);

  const processQueued = useCallback(async (tokenCeiling = 400_000, confirmOver = 15) => {
    const list = await api<{ companies: { id: number; status: string; name: string | null; domain: string }[] }>("/api/companies");
    const queued = list.companies.filter((c) => c.status === "queued").slice(0, 25);
    if (!queued.length) { say("Nothing queued to research."); return; }
    if (queued.length > confirmOver && !window.confirm(`${queued.length} companies are queued. Research them all?`)) { say("Stopped: batch not confirmed."); return; }
    let tokens = 0;
    for (const [i, c] of queued.entries()) {
      if (stop.current) { say("Stopped."); break; }
      say(`Researching ${i + 1} of ${queued.length}: ${c.name ?? c.domain}...`);
      try {
        const r = await api<{ status: string; reason: string | null; tokens: number }>("/api/run-company", { method: "POST", body: { id: c.id } });
        tokens += r.tokens ?? 0;
        say(`   ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
      } catch (e) { say(`   error: ${(e as Error).message}`); }
      onChange();
      if (tokens > tokenCeiling) {
        say(`Paused: this run used ${tokens.toLocaleString()} tokens, over the ${tokenCeiling.toLocaleString()} ceiling.`);
        await api("/api/review", { method: "POST", body: { reason: `run paused after ${tokens.toLocaleString()} tokens (ceiling ${tokenCeiling.toLocaleString()})` } }).catch(() => {});
        break;
      }
    }
  }, [onChange]);

  const run = useCallback(async (mode: "all" | "discover" | "process" = "all") => {
    setBusy(true); setLog([]); stop.current = false;
    try {
      const icp = await api<{ config: { tokensPerRun: number; confirmBatchOver: number } }>("/api/icp");
      if (mode !== "process") {
        say("Searching hiring posts, the web and funding news...");
        const d = await api<{ found: number; added: number; unresolved: number; alreadySeen: number; queuedIds: number[]; sourceErrors: string[] }>("/api/discover", { method: "POST", body: {} });
        say(`Found ${d.found}: ${d.added} new with a verified site, ${d.unresolved} unresolved, ${d.alreadySeen} already seen. Queued ${d.queuedIds.length}.`);
        d.sourceErrors?.slice(0, 4).forEach((s) => say(`   source problem: ${s}`));
        onChange();
      }
      if (mode !== "discover") await processQueued(icp.config.tokensPerRun, icp.config.confirmBatchOver);
      say("Done.");
    } catch (e) { say(`Error: ${(e as Error).message}`); }
    setBusy(false); onChange();
  }, [onChange, processQueued]);

  return { busy, log, run, stop: () => { stop.current = true; } };
}

export function LogBox({ log }: { log: string[] }) {
  if (!log.length) return null;
  return <div className="card small"><pre style={{ margin: 0 }}>{log.join("\n")}</pre></div>;
}
