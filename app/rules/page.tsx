"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { PageHead, useApi } from "@/components/ui";

type Cfg = {
  thesis: string; allowedStages: string[]; targetFrameworks: string[]; excludedCategories: string[]; competitors: string[];
  minOpenRolesForStage: number; fundingRecencyDays: number;
  weights: { saas: number; stage: number; enterprise: number; trigger: number; data: number };
  thresholds: { qualified: number; flagged: number; maybe: number };
  penalties: { certUnverified: number; stageUnknown: number };
  loopFetchCap: number; hunter: { monthlyCap: number; autoAcceptScore: number }; rerunDays: number;
  tokensPerCompany: number; tokensPerRun: number; usdPerMillionTokens: number; confirmBatchOver: number; discoveryDailyCap: number;
  email: { minWords: number; maxWords: number; bannedPhrases: string[] }; followUpDays: number[];
  emailStyleNotes: string[]; preferredTitleKeywords: string[]; sourcePriority: string[];
};
type Resp = { config: Cfg; version: number; versions: { version: number; note: string; active: boolean; created_by: string; created_at: string }[]; stages: string[] };
type Preview = { problems: string[]; moved: { id: number; company: string; from: string; to: string; fromScore: number; toScore: number }[]; total: number; movedCount?: number };

const FRAMEWORKS = ["SOC 2", "ISO 27001", "GDPR", "HIPAA", "PCI DSS"];

function Num({ label, value, onChange, hint, min = 0, max }: { label: string; value: number; onChange: (n: number) => void; hint?: string; min?: number; max?: number }) {
  return <div className="field"><label>{label}</label><input type="number" min={min} max={max} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />{hint && <div className="hint">{hint}</div>}</div>;
}
function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="chips">{options.map((o) => <button type="button" key={o} className={`chipbtn ${value.includes(o) ? "on" : ""}`} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>{o}</button>)}</div>;
}
function Tags({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [t, setT] = useState("");
  const add = () => { const v = t.trim(); if (v && !value.includes(v)) onChange([...value, v]); setT(""); };
  return (
    <div>
      <div className="chips" style={{ marginBottom: 8 }}>{value.map((v) => <button type="button" key={v} className="chipbtn on" title="Click to remove" onClick={() => onChange(value.filter((x) => x !== v))}>{v} ×</button>)}</div>
      <div className="row"><input style={{ maxWidth: 320 }} placeholder={placeholder} value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} /><button type="button" className="ghost" onClick={add}>Add</button></div>
    </div>
  );
}

export default function Rules() {
  const { data, reload, error } = useApi<Resp>("/api/icp");
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [tab, setTab] = useState("icp");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [prev, setPrev] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (data) setCfg(data.config); }, [data]);

  // live "what would change" preview
  useEffect(() => {
    if (!cfg || !data) return;
    if (JSON.stringify(cfg) === JSON.stringify(data.config)) { setPrev(null); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { api<Preview>("/api/icp/preview", { body: { config: cfg } }).then(setPrev).catch(() => {}); }, 600);
  }, [cfg, data]);

  if (!cfg || !data) return <><PageHead title="ICP & Rules" /><main>{error ? <div className="card">Error: {error}</div> : "Loading..."}</main></>;
  const set = (patch: Partial<Cfg>) => setCfg({ ...cfg, ...patch });
  const total = Object.values(cfg.weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(data.config);

  async function save() {
    setMsg("");
    try { const r = await api<{ version: number }>("/api/icp", { body: { config: cfg, note: note || "edited" } }); setMsg(`Saved as v${r.version}. New runs use it immediately.`); setNote(""); await reload(); } catch (e) { setMsg((e as Error).message); }
  }
  async function act(body: Record<string, unknown>, ok: string) {
    try { await api("/api/icp", { body }); setMsg(ok); await reload(); } catch (e) { setMsg((e as Error).message); }
  }
  const W = (k: keyof Cfg["weights"], label: string) => <Num label={label} value={cfg.weights[k]} onChange={(n) => set({ weights: { ...cfg.weights, [k]: n } })} max={100} />;

  return (
    <>
      <PageHead title="ICP & Rules" sub={<>Every number here is read fresh from the database on each run, no deploy needed. Active version v{data.version}. Every save is versioned and logged.</>} />
      <main>
        <div className="tabs"><button className={tab === "icp" ? "on" : ""} onClick={() => setTab("icp")}>ICP &amp; gates</button><button className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>Email rules</button></div>

        {tab === "icp" && (<>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Thesis</h2>
            <div className="hint small muted">Describes who we are looking for.</div>
            <textarea style={{ minHeight: 70 }} value={cfg.thesis} onChange={(e) => set({ thesis: e.target.value })} />
            <h2>Allowed funding stages</h2>
            <Chips options={data.stages} value={cfg.allowedStages} onChange={(v) => set({ allowedStages: v })} />
            <h2>Target frameworks</h2>
            <div className="small muted" style={{ marginBottom: 6 }}>Showing one of these = already certified (the company is dropped).</div>
            <Chips options={[...new Set([...FRAMEWORKS, ...cfg.targetFrameworks])]} value={cfg.targetFrameworks} onChange={(v) => set({ targetFrameworks: v })} />
            <h2>Excluded categories</h2>
            <Tags value={cfg.excludedCategories} onChange={(v) => set({ excludedCategories: v })} placeholder="e.g. consulting" />
            <h2>Competitors (never contacted)</h2>
            <Tags value={cfg.competitors} onChange={(v) => set({ competitors: v })} placeholder="domain, e.g. vanta.com" />
            <div className="formgrid" style={{ marginTop: 16 }}>
              <Num label="Open roles that prove the right stage" value={cfg.minOpenRolesForStage} onChange={(n) => set({ minOpenRolesForStage: n })} />
              <Num label="Funding recency window (days)" value={cfg.fundingRecencyDays} onChange={(n) => set({ fundingRecencyDays: n })} hint="A raise inside this window counts as a trigger" />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Score weights <span className={`pill ${total === 100 ? "ok" : "bad"}`}>total {total} / 100</span></h2>
            <div className="formgrid">{W("saas", "B2B SaaS fit")}{W("stage", "Stage fit")}{W("enterprise", "Enterprise pull")}{W("trigger", "Compliance trigger (why now)")}{W("data", "Data sensitivity")}</div>
            <h2>Thresholds <span className="small muted">Qualified &gt; Flagged &gt; Maybe, below Maybe is dropped</span></h2>
            <div className="formgrid">
              <Num label="Qualified from" value={cfg.thresholds.qualified} onChange={(n) => set({ thresholds: { ...cfg.thresholds, qualified: n } })} max={100} />
              <Num label="Flagged from" value={cfg.thresholds.flagged} onChange={(n) => set({ thresholds: { ...cfg.thresholds, flagged: n } })} max={100} />
              <Num label="Maybe from" value={cfg.thresholds.maybe} onChange={(n) => set({ thresholds: { ...cfg.thresholds, maybe: n } })} max={100} />
            </div>
            <h2>Penalties</h2>
            <div className="formgrid">
              <Num label="Certification not verified" value={cfg.penalties.certUnverified} onChange={(n) => set({ penalties: { ...cfg.penalties, certUnverified: n } })} />
              <Num label="Stage not verified" value={cfg.penalties.stageUnknown} onChange={(n) => set({ penalties: { ...cfg.penalties, stageUnknown: n } })} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Limits and costs</h2>
            <div className="formgrid">
              <Num label="Loop fetch cap" value={cfg.loopFetchCap} onChange={(n) => set({ loopFetchCap: n })} min={1} max={6} hint="Pages fetched beyond the homepage (1-6)" />
              <Num label="Hunter monthly searches" value={cfg.hunter.monthlyCap} onChange={(n) => set({ hunter: { ...cfg.hunter, monthlyCap: n } })} />
              <Num label="Contact auto-accept score" value={cfg.hunter.autoAcceptScore} onChange={(n) => set({ hunter: { ...cfg.hunter, autoAcceptScore: n } })} hint="Below this a human confirms the contact" />
              <Num label="Re-run window (days)" value={cfg.rerunDays} onChange={(n) => set({ rerunDays: n })} hint="Skip companies processed this recently" />
              <Num label="Token ceiling per company" value={cfg.tokensPerCompany} onChange={(n) => set({ tokensPerCompany: n })} />
              <Num label="Token ceiling per run" value={cfg.tokensPerRun} onChange={(n) => set({ tokensPerRun: n })} hint="Run pauses and asks you (H7)" />
              <Num label="Price per 1M tokens (USD)" value={cfg.usdPerMillionTokens} onChange={(n) => set({ usdPerMillionTokens: n })} hint="Estimate for the cost metric" />
              <Num label="Confirm batches over" value={cfg.confirmBatchOver} onChange={(n) => set({ confirmBatchOver: n })} hint="companies" />
              <Num label="Discovery daily cap" value={cfg.discoveryDailyCap} onChange={(n) => set({ discoveryDailyCap: n })} hint="companies queued per day" />
            </div>
            <div className="field" style={{ marginTop: 12, maxWidth: 320 }}><label>Follow-up days after the first email</label>
              <input value={cfg.followUpDays.join(", ")} onChange={(e) => set({ followUpDays: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} /></div>
            <h2>Learned from your choices <span className="small muted">usually filled by approving suggestions on the Learning page</span></h2>
            <div className="small muted" style={{ marginBottom: 6 }}>Job-title words that boost a contact</div>
            <Tags value={cfg.preferredTitleKeywords} onChange={(v) => set({ preferredTitleKeywords: v })} placeholder="e.g. security" />
            <div className="small muted" style={{ margin: "14px 0 6px" }}>Discovery source order (first = queued first)</div>
            <div className="chips">{cfg.sourcePriority.map((s, i) => (
              <span key={s} className="chipbtn on" style={{ cursor: "default" }}>{i + 1}. {s}
                <button type="button" className="ghost" style={{ padding: "0 6px", marginLeft: 6, background: "transparent", color: "#fff", border: 0 }} disabled={i === 0}
                  onClick={() => { const a = [...cfg.sourcePriority]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set({ sourcePriority: a }); }}>↑</button></span>
            ))}</div>
          </div>
        </>)}

        {tab === "email" && (
          <div className="card">
            <div className="formgrid">
              <Num label="Minimum words" value={cfg.email.minWords} onChange={(n) => set({ email: { ...cfg.email, minWords: n } })} />
              <Num label="Maximum words" value={cfg.email.maxWords} onChange={(n) => set({ email: { ...cfg.email, maxWords: n } })} />
            </div>
            <h2>Banned phrases</h2>
            <Tags value={cfg.email.bannedPhrases} onChange={(v) => set({ email: { ...cfg.email, bannedPhrases: v } })} placeholder="phrase the email must never use" />
            <p className="small muted">Drafts that break these rules are flagged for your review before they can be sent.</p>
            <h2>Style notes for the writer</h2>
            <div className="small muted" style={{ marginBottom: 6 }}>Extra instructions added to every draft, e.g. "Keep emails under 90 words". Often filled by approving suggestions on the Learning page.</div>
            <Tags value={cfg.emailStyleNotes} onChange={(v) => set({ emailStyleNotes: v })} placeholder="a short instruction" />
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          {!dirty && <p className="muted">Change a value to see which existing accounts would move. Active: v{data.version}.</p>}
          {dirty && prev?.problems.length ? <div className="banner bad">{prev.problems.join("; ")}</div> : null}
          {dirty && prev && !prev.problems.length && (
            <>
              <p><b>{prev.movedCount ?? prev.moved.length}</b> of {prev.total} accounts would change tier.</p>
              {prev.moved.map((m) => <div className="small" key={m.id}><b>{m.company}</b> · tier {m.from} ({m.fromScore}) → tier {m.to} ({m.toScore})</div>)}
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <input style={{ maxWidth: 320 }} placeholder="What did you change? (optional note)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button disabled={!dirty || total !== 100} onClick={save}>Save as new version</button>
            <button className="ghost" disabled={!dirty} onClick={() => setCfg(data.config)}>Discard changes</button>
          </div>
          {msg && <div className="small" style={{ marginTop: 8 }}>{msg}</div>}
        </div>

        <h2>Versions</h2>
        <div className="card">
          {data.versions.map((v) => (
            <div className="row" key={v.version} style={{ padding: "6px 0", borderBottom: "1px solid #ece9fb" }}>
              <b>v{v.version}</b><span className="muted small">{v.note} · {v.created_by} · {new Date(v.created_at).toLocaleString("en-IN")}</span>
              {v.active ? <span className="pill ok right">active</span> : <button className="ghost right" style={{ padding: "3px 12px" }} onClick={() => act({ activate: v.version }, `v${v.version} is now active.`)}>Activate</button>}
            </div>
          ))}
          <div style={{ marginTop: 10 }}><button className="ghost" onClick={() => window.confirm("Reset every number to the defaults as a new version?") && act({ reset: true }, "Reset to defaults (saved as a new version).")}>Reset to defaults</button></div>
        </div>
      </main>
    </>
  );
}
