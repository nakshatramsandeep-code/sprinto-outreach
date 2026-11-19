"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { PageHead, useApi, ago } from "@/components/ui";

type Expected = { certified?: boolean; saas?: "yes" | "no" | "unclear"; stage?: string };
type Gate = { name: string; value: number | null; threshold: number; pass: boolean | null };
type Metrics = {
  n: number; certified: { n: number; tp: number; fp: number; fn: number; tn: number; accuracy: number | null; precision: number | null; recall: number | null };
  saas: { n: number; correct: number; wrong: number; abstain: number; accuracy: number | null; coverage: number | null };
  stage: { n: number; correct: number; accuracy: number | null }; rejectedQuotesPct: number | null; avgTokens: number; avgMs: number;
};
type Run = { id: number; kind: string; model: string; prompt_hash: string; icp_version: number | null; note: string | null; metrics: any; created_at: string };
type EffGate = { name: string; value: string; limit: string; pass: boolean };
type LoopGate = { name: string; value: number; threshold: string; pass: boolean };
type Resp = {
  loopLatest: (Run & { metrics: { allPass: boolean; gates: LoopGate[]; weights: any; weightsLong: any; edits: any; contacts: any } }) | null;
  cases: { id: number; domain: string; name: string | null; expected: Expected; labeled_by: string | null; company_id: number | null; pages: number; labeled: boolean; system: { certified: boolean; saas: boolean | null; stage: string | null } | null }[];
  runs: Run[];
  latest: (Run & { metrics: Metrics & { p50Ms?: number; p95Ms?: number }; gates: Gate[]; efficiency?: EffGate[]; regressions: string[]; failures: any[] }) | null;
  emailLatest: (Run & { rows: any[] }) | null;
  current: { extractHash: string; emailHash: string; fastModel: string; proModel: string };
  gates: Record<string, number>;
  companies: { id: number; name: string; domain: string }[];
};

const pct = (x: number | null | undefined) => (x == null ? "-" : `${Math.round(x * 100)}%`);

function CaseRow({ c, onDone }: { c: Resp["cases"][number]; onDone: () => void }) {
  const [e, setE] = useState<Expected>(c.expected ?? {});
  const [msg, setMsg] = useState("");
  useEffect(() => setE(c.expected ?? {}), [c.id, c.expected]);
  const sysText = c.system ? `certified: ${c.system.certified ? "yes" : "no"} · B2B SaaS: ${c.system.saas === null ? "unclear" : c.system.saas ? "yes" : "no"} · stage: ${c.system.stage ?? "none"}` : "not researched";
  const save = async () => { setMsg(""); try { await api(`/api/evals/cases/${c.id}`, { method: "PATCH", body: { expected: e } }); setMsg("Saved"); onDone(); } catch (x) { setMsg((x as Error).message); } };
  const sel = { padding: 8, borderRadius: 10, border: "1px solid var(--line)", background: "#fff", font: "inherit" } as const;
  const who = c.labeled_by === "owner" ? <span className="pill ok">confirmed by you</span> : c.labeled_by ? <span className="pill warn">draft label by {c.labeled_by}: please confirm</span> : <span className="pill">unlabelled</span>;
  return (
    <div className="cardlet">
      <div className="row"><b>{c.name ?? c.domain}</b><span className="muted small">{c.domain} · {c.pages} page{c.pages === 1 ? "" : "s"}</span>{who}
        <button className="ghost right" style={{ padding: "3px 12px" }} onClick={async () => { if (window.confirm("Remove this case from the golden set?")) { await api(`/api/evals/cases/${c.id}`, { method: "DELETE" }); onDone(); } }}>Remove</button></div>
      <div className="small muted" style={{ margin: "4px 0 8px" }}>System said: {sysText}</div>
      <div className="row">
        <label className="small">Certified (SOC 2 / ISO / etc.)? <select style={sel} value={e.certified === undefined ? "" : String(e.certified)} onChange={(x) => setE({ ...e, certified: x.target.value === "" ? undefined : x.target.value === "true" })}><option value="">not labelled</option><option value="true">yes</option><option value="false">no</option></select></label>
        <label className="small">B2B SaaS? <select style={sel} value={e.saas ?? ""} onChange={(x) => setE({ ...e, saas: (x.target.value || undefined) as Expected["saas"] })}><option value="">not labelled</option><option value="yes">yes</option><option value="no">no</option><option value="unclear">unclear</option></select></label>
        <label className="small">Stage on the pages (or "none") <input style={{ ...sel, width: 130 }} value={e.stage ?? ""} onChange={(x) => setE({ ...e, stage: x.target.value || undefined })} placeholder="Series B" /></label>
        <button onClick={save}>Save as confirmed</button>{msg && <span className="small">{msg}</span>}
      </div>
    </div>
  );
}

export default function Evals() {
  const { data, reload, error } = useApi<Resp>("/api/evals");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState("");

  async function run(kind: "extraction" | "email" | "loop") {
    setBusy(kind); setMsg(kind === "loop" ? "Running the feedback-loop simulation..." : `Running the ${kind} eval (up to a minute)...`);
    try { await api("/api/evals/run", { body: { kind } }); setMsg("Done."); } catch (e) { setMsg((e as Error).message); }
    setBusy(""); reload();
  }
  async function addCase() {
    if (!add) return;
    try { await api("/api/evals/cases", { body: { companyId: Number(add) } }); setAdd(""); setMsg("Case added. Now label it below."); } catch (e) { setMsg((e as Error).message); }
    reload();
  }

  const l = data?.latest;
  const stale = l && data && (l.prompt_hash !== data.current.extractHash || l.model !== data.current.fastModel);
  const labelled = data?.cases.filter((c) => c.labeled).length ?? 0;
  const unconfirmed = data?.cases.filter((c) => c.labeled && c.labeled_by !== "owner").length ?? 0;
  const ex = (data?.runs ?? []).filter((r) => r.kind === "extraction");

  return (
    <>
      <PageHead title="Evals" sub="Does the model still get the facts right? Scored against a human-labelled golden set, with release gates."
        right={<><button onClick={() => run("extraction")} disabled={!!busy}>{busy === "extraction" ? "Running..." : "Run extraction eval"}</button><button className="ghost" onClick={() => run("email")} disabled={!!busy}>{busy === "email" ? "Running..." : "Run email eval"}</button><button className="ghost" onClick={() => run("loop")} disabled={!!busy}>{busy === "loop" ? "Running..." : "Run loop simulation"}</button></>} />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        {msg && <div className="card small">{msg}</div>}
        {stale && <div className="banner warn"><b>The model or prompt changed since the last eval</b> (last run {l!.model} / prompt {l!.prompt_hash}, now {data!.current.fastModel} / prompt {data!.current.extractHash}). Run the extraction eval before relying on it.</div>}
        {unconfirmed > 0 && <div className="banner warn"><b>{unconfirmed} label{unconfirmed === 1 ? "" : "s"} still need your confirmation.</b> Draft labels were written by Claude from the page text. Until you confirm them, treat eval scores as indicative, not as truth.</div>}

        <h2>Extraction eval: latest run</h2>
        {!l ? <div className="card muted">No run yet. Label some cases below, then press Run extraction eval.</div> : (<>
          {l.regressions.length > 0 && <div className="banner bad"><b>Regression vs the previous run:</b> {l.regressions.join(" · ")}</div>}
          <div className="card">
            <div className="small muted">Run #{l.id} · {ago(l.created_at)} ago · {l.model} · prompt {l.prompt_hash} · ICP v{l.icp_version} · {l.metrics.n} cases · avg {l.metrics.avgTokens} tokens, {(l.metrics.avgMs / 1000).toFixed(1)}s per case</div>
            <table style={{ marginTop: 8 }}><thead><tr><th>Release gate</th><th>Score</th><th>Needs</th><th></th></tr></thead><tbody>
              {l.gates.map((g) => (
                <tr key={g.name}><td>{g.name}</td><td><b>{pct(g.value)}</b></td><td className="muted">{pct(g.threshold)}</td>
                  <td>{g.pass === null ? <span className="pill">not enough labels</span> : g.pass ? <span className="pill ok">pass</span> : <span className="pill bad">fail</span>}</td></tr>
              ))}
            </tbody></table>
            <div className="small muted" style={{ marginTop: 8 }}>
              Certified: {l.metrics.certified.tp} caught, <b style={{ color: l.metrics.certified.fn ? "var(--bad)" : undefined }}>{l.metrics.certified.fn} missed</b> (we would email a company that already has the certificate), {l.metrics.certified.fp} wrongly flagged (we would drop a good lead).
              {" "}B2B SaaS: {l.metrics.saas.correct} right, {l.metrics.saas.wrong} wrong, {l.metrics.saas.abstain} said unclear (coverage {pct(l.metrics.saas.coverage)}).
              {" "}Unverifiable quotes rejected: {pct(l.metrics.rejectedQuotesPct)} of the model's claims.
            </div>
          </div>
          {l.efficiency && l.efficiency.length > 0 && (
            <div className="card">
              <b>Efficiency</b> <span className="small muted">{l.metrics.p50Ms ? `median ${(l.metrics.p50Ms / 1000).toFixed(1)}s per company, slowest 5% ${((l.metrics.p95Ms ?? 0) / 1000).toFixed(1)}s` : ""}</span>
              <table style={{ marginTop: 6 }}><tbody>
                {l.efficiency.map((g) => <tr key={g.name}><td>{g.name}</td><td><b>{g.value}</b></td><td className="muted">{g.limit}</td><td>{g.pass ? <span className="pill ok">pass</span> : <span className="pill bad">over budget</span>}</td></tr>)}
              </tbody></table>
            </div>
          )}
          {l.failures.length > 0 && (<>
            <h3 style={{ marginBottom: 6 }}>Cases it got wrong</h3>
            {l.failures.map((f: any, i: number) => (
              <div className="cardlet" key={i}><b>{f.domain}</b> {f.error ? <span className="pill bad">{f.error}</span> : <>
                <div className="small">Expected: {JSON.stringify(f.expected)} · Got: {JSON.stringify(f.predicted)}</div>
                <div className="small muted">{(f.evidence?.certs ?? []).join(" | ")} {f.evidence?.stageQuote ? `stage: "${f.evidence.stageQuote}"` : ""}</div></>}</div>
            ))}
          </>)}
        </>)}

        <h2>Run history</h2>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table><thead><tr><th>Run</th><th>When</th><th>Model</th><th>Prompt</th><th>Cases</th><th>Certified acc.</th><th>Recall</th><th>SaaS acc.</th><th>Stage acc.</th></tr></thead><tbody>
            {ex.length === 0 && <tr><td colSpan={9} className="muted">No runs yet.</td></tr>}
            {ex.map((r) => <tr key={r.id}><td>#{r.id}</td><td className="muted small">{ago(r.created_at)}</td><td className="small">{r.model}</td><td className="mono">{r.prompt_hash}</td><td>{r.metrics.n}</td>
              <td>{pct(r.metrics.certified.accuracy)}</td><td>{pct(r.metrics.certified.recall)}</td><td>{pct(r.metrics.saas.accuracy)}</td><td>{pct(r.metrics.stage.accuracy)}</td></tr>)}
          </tbody></table>
        </div>

        <h2>Email eval</h2>
        <div className="card">
          <p className="small muted" style={{ marginTop: 0 }}>Writes emails for labelled, non-certified B2B SaaS cases using a made-up contact (never sent), then checks the hard rules and asks a judge model to score them. The judge is the same model family, so treat its scores as a signal, not proof.</p>
          {!data?.emailLatest ? <span className="muted">No run yet.</span> : (() => { const m = data.emailLatest.metrics; return (<>
            <div className="small muted">Run #{data.emailLatest.id} · {ago(data.emailLatest.created_at)} ago · {data.emailLatest.model} · prompt {data.emailLatest.prompt_hash} · {m.n} emails</div>
            <div className="grid kpis" style={{ marginTop: 8 }}>
              <div className="kpi"><div className="label">Passed checks first try</div><div className="value" style={{ fontSize: 26 }}>{pct(m.firstTryValidPct)}</div></div>
              <div className="kpi"><div className="label">Hook tied to evidence</div><div className="value" style={{ fontSize: 26 }}>{pct(m.groundedHookPct)}</div></div>
              <div className="kpi"><div className="label">Specific hook (1-5)</div><div className="value" style={{ fontSize: 26 }}>{m.avgSpecific ?? "-"}</div></div>
              <div className="kpi"><div className="label">Role relevance (1-5)</div><div className="value" style={{ fontSize: 26 }}>{m.avgRelevance ?? "-"}</div></div>
              <div className="kpi"><div className="label">Tone (1-5)</div><div className="value" style={{ fontSize: 26 }}>{m.avgTone ?? "-"}</div></div>
              <div className="kpi"><div className={m.unsupportedPct ? "label" : "label"}>Had unsupported claims</div><div className="value" style={{ fontSize: 26 }}>{pct(m.unsupportedPct)}</div></div>
            </div>
            {data.emailLatest.rows.filter((r: any) => r.judge?.unsupported_claims?.length).map((r: any) => <div className="small" key={r.domain} style={{ marginTop: 6 }}><b>{r.domain}</b> unsupported: {r.judge.unsupported_claims.join("; ")}</div>)}
          </>); })()}
        </div>

        <h2>Feedback-loop simulation</h2>
        <div className="card">
          <p className="small muted" style={{ marginTop: 0 }}>Real outcome data is thin, so this proves the <i>mechanism</i>. It invents a world where the truth is known (what really drives replies, what you really prefer), feeds the learning engine the signals a real owner would produce, applies what it suggests, and measures whether things got better. It also checks the engine stays <b>quiet on noise and on too little data</b>. Seeded and repeatable; it does not predict your actual reply rate.</p>
          {!data?.loopLatest ? <span className="muted">No run yet. Press Run loop simulation.</span> : (() => { const r = data.loopLatest.metrics; const show = (g: LoopGate) => (/%|pts/.test(g.threshold) ? `${Math.round(g.value * 1000) / 10}${g.threshold.includes("pts") ? " pts" : "%"}` : String(g.value)); return (<>
            <div className="small muted">Run #{data.loopLatest.id} · {ago(data.loopLatest.created_at)} ago · {r.allPass ? "all gates pass" : "some gates FAIL"}</div>
            <table style={{ marginTop: 6 }}><thead><tr><th>Check</th><th>Result</th><th>Needs</th><th></th></tr></thead><tbody>
              {r.gates.map((g: LoopGate) => <tr key={g.name}><td>{g.name}</td><td><b>{show(g)}</b></td><td className="muted">{g.threshold}</td><td>{g.pass ? <span className="pill ok">pass</span> : <span className="pill bad">fail</span>}</td></tr>)}
            </tbody></table>
            <div className="small muted" style={{ marginTop: 8 }}>
              Score weights: correlation with true reply odds {r.weights.signal.meanCorrBefore} → {r.weights.signal.meanCorrAfter} after 250 emails and → {r.weightsLong.signal.meanCorrAfter} after 600 (best possible inside the safety cap: {r.weights.signal.meanCorrCeiling}).
              Edits: your edit rate on the repeated phrase {Math.round(r.edits.withFlaw.editRateBefore * 100)}% → {Math.round(r.edits.withFlaw.editRateAfter * 100)}%.
              Contacts: agreement with your pick {Math.round(r.contacts.preference.agreementBefore * 100)}% → {Math.round(r.contacts.preference.agreementAfter * 100)}%.
              Learning is deliberately slow and cautious: it needs a fresh batch of 40+ outcomes for each weights change.
            </div>
          </>); })()}
        </div>

        <h2>Golden set <span className="muted small">{labelled} labelled of {data?.cases.length ?? 0}</span></h2>
        <div className="card">
          <p className="small muted" style={{ marginTop: 0 }}>Each case is a snapshot of an account's pages plus the correct answers. Gates need at least {data?.gates.minCases ?? 10} labelled cases to count. Disqualifying an account in the Review queue adds it here automatically.</p>
          <div className="row" style={{ marginBottom: 12 }}>
            <select value={add} onChange={(e) => setAdd(e.target.value)} style={{ padding: 9, borderRadius: 12, border: "1px solid var(--line)", background: "#fff", maxWidth: 320 }}>
              <option value="">Add an account to the set...</option>{data?.companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
            </select>
            <button className="ghost" disabled={!add} onClick={addCase}>Add case</button>
          </div>
          {data?.cases.map((c) => <CaseRow key={c.id} c={c} onDone={reload} />)}
        </div>
      </main>
    </>
  );
}
