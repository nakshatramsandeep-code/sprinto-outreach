"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { PageHead, useApi, Toggle } from "@/components/ui";

type Profile = { senderName: string; signoff: string; oneLiner: string; proofPoints: { text: string; source: string }[] };
type Resp = {
  integrations: { name: string; ok: boolean; optional?: boolean; note?: string }[];
  demo: { on: boolean; inbox: string | null };
  autoQueue: boolean; profile: Profile; sources: string[];
  log: { id: number; actor: string; action: string; detail: any; created_at: string }[];
};

export default function Settings() {
  const { data, reload, error } = useApi<Resp>("/api/settings");
  const [p, setP] = useState<Profile | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (data) setP(data.profile); }, [data]);
  if (!data || !p) return <><PageHead title="Settings" /><main>{error ? <div className="card">Error: {error}</div> : "Loading..."}</main></>;

  async function save() {
    setMsg("");
    try { await api("/api/settings", { body: { profile: p } }); setMsg("Saved."); await reload(); } catch (e) { setMsg((e as Error).message); }
  }
  const setProof = (i: number, patch: Partial<Profile["proofPoints"][number]>) => setP({ ...p, proofPoints: p.proofPoints.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <>
      <PageHead title="Settings" sub="Integrations, demo mode and the Sprinto sender profile." />
      <main>
        <h2>Integrations</h2>
        <div className="card">
          {data.integrations.map((i) => (
            <div className="row" key={i.name} style={{ padding: "6px 0", borderBottom: "1px solid #ece9fb" }}>
              <b>{i.name}</b>{i.optional && <span className="muted small">optional</span>}
              {i.note && <span className="muted small">{i.note}</span>}
              <span className={`pill right ${i.ok ? "ok" : i.optional ? "" : "bad"}`}>{i.ok ? "Configured" : "Missing"}</span>
            </div>
          ))}
        </div>

        <h2>Demo mode</h2>
        <div className="card">
          <div className="row"><span className="pill ok">On, and locked</span><span className="small">Every email goes to the demo inbox <b>{data.demo.inbox ?? "(OWNER_EMAIL not set)"}</b> with a "would go to" banner. There is no code path that sends to a prospect.</span></div>
          <div style={{ marginTop: 10 }}><Toggle on={data.autoQueue} onChange={async (v) => { await api("/api/settings", { body: { autoQueue: v } }); reload(); }} label="Auto-queue discovered companies" /></div>
        </div>

        <h2>Sprinto sender profile</h2>
        <div className="card">
          <p className="small muted" style={{ marginTop: 0 }}>Proof points must be copied from sprinto.com, with the page they came from. The system never invents customer names or numbers, and only uses proof points listed here.</p>
          <div className="formgrid">
            <div className="field"><label>Sender name</label><input value={p.senderName} onChange={(e) => setP({ ...p, senderName: e.target.value })} /></div>
            <div className="field"><label>Sign-off line 2 (company / title)</label><input value={p.signoff} onChange={(e) => setP({ ...p, signoff: e.target.value })} /></div>
          </div>
          <div className="field" style={{ marginTop: 12 }}><label>One-liner</label><input value={p.oneLiner} onChange={(e) => setP({ ...p, oneLiner: e.target.value })} /></div>
          <h2 style={{ fontSize: 16 }}>Proof points</h2>
          {p.proofPoints.map((x, i) => (
            <div className="row" key={i} style={{ marginBottom: 8, alignItems: "flex-start" }}>
              <input style={{ flex: 2, minWidth: 220 }} placeholder="Proof point, copied word for word" value={x.text} onChange={(e) => setProof(i, { text: e.target.value })} />
              <input style={{ flex: 1, minWidth: 180 }} placeholder="Source page, e.g. sprinto.com/pricing" value={x.source} onChange={(e) => setProof(i, { source: e.target.value })} />
              <button className="ghost" onClick={() => setP({ ...p, proofPoints: p.proofPoints.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="row"><button className="ghost" onClick={() => setP({ ...p, proofPoints: [...p.proofPoints, { text: "", source: "" }] })}>Add proof point</button><button onClick={save}>Save profile</button>{msg && <span className="small">{msg}</span>}</div>
        </div>

        <h2>Discovery sources</h2>
        <div className="card small">
          <p className="muted" style={{ marginTop: 0 }}>Hacker News hiring posts, Google Search through Gemini, and these funding-news feeds. Started with the Run button (no schedule in this build).</p>
          {data.sources.map((s) => <div key={s}>{s}</div>)}
        </div>

        <h2>Audit log <span className="muted small">last 12</span></h2>
        <div className="card small">
          {data.log.length === 0 && <span className="muted">Nothing logged yet.</span>}
          {data.log.map((l) => <div key={l.id} style={{ marginBottom: 4 }}><span className="muted">{new Date(l.created_at).toLocaleString("en-IN")}</span> · <b>{l.actor}</b> · {l.action}{l.detail?.reason ? ` · “${l.detail.reason}”` : ""}</div>)}
        </div>
      </main>
    </>
  );
}
