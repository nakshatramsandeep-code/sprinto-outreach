"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { PageHead, useApi, StatusChip, Tier } from "@/components/ui";

type Draft = { id: number; kind: string; subject: string; body: string; pains: { pain: string; evidence_field: string }[]; hook_field: string; validation: { ok: boolean; problems: string[] }; review_status: string; edited: boolean; outcome: string | null };
type Detail = {
  company: any;
  steps: { id: number; step: string; detail: any; tokens: number; created_at: string }[];
  drafts: Draft[];
  checkpoints: { id: number; kind: string; reason: string }[];
  icp: { version: number; usdPerMillionTokens: number };
};

function DraftEditor({ d, onDone }: { d: Draft; onDone: () => void }) {
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSubject(d.subject); setBody(d.body); }, [d.id, d.subject, d.body]);
  const locked = ["sent", "rejected", "sending"].includes(d.review_status);
  const words = (body.match(/\S+/g) ?? []).length;

  async function act(kind: "send" | "edit" | "reject") {
    setBusy(true); setMsg("");
    try {
      if (kind === "send") { await api("/api/send", { body: { draftId: d.id, subject, body } }); setMsg("Sent to the demo inbox."); }
      if (kind === "edit") { await api(`/api/drafts/${d.id}`, { method: "PATCH", body: { action: "edit", subject, body } }); setMsg("Saved."); }
      if (kind === "reject") { await api(`/api/drafts/${d.id}`, { method: "PATCH", body: { action: "reject" } }); setMsg("Rejected."); }
      onDone();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="card">
      <div className="row small muted">
        <b style={{ color: "var(--navy)" }}>{d.kind === "first" ? "First email" : d.kind.replace("_", " ")}</b>
        <span className="pill">{d.review_status}{d.edited ? " · edited" : ""}</span>
        {d.hook_field && d.kind === "first" && <span>hook from <b>{d.hook_field}</b></span>}
        <span className="right">{words} words</span>
      </div>
      {d.kind === "first" && d.pains?.length > 0 && (
        <ul className="small" style={{ margin: "8px 0" }}>{d.pains.map((p, i) => <li key={i}>{p.pain} <span className="muted">(evidence: {p.evidence_field})</span></li>)}</ul>
      )}
      {!d.validation?.ok && d.kind === "first" && <div className="small" style={{ color: "var(--warn)" }}>Checks failed: {d.validation?.problems?.join("; ")}</div>}
      <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} style={{ marginTop: 8 }} />
      <textarea style={{ marginTop: 8 }} value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} />
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={busy || locked} onClick={() => act("send")}>Approve &amp; send to demo inbox</button>
        <button className="ghost" disabled={busy || locked} onClick={() => act("edit")}>Save edit</button>
        <button className="danger" disabled={busy || locked} onClick={() => act("reject")}>Reject</button>
        {d.review_status === "sent" && (
          <span className="row right small">Result:
            {(["replied", "meeting", "no_reply"] as const).map((o) => (
              <button key={o} className={`ghost ${d.outcome === o ? "on" : ""}`} style={{ padding: "4px 12px", ...(d.outcome === o ? { background: "var(--plum)", color: "#fff" } : {}) }}
                onClick={async () => { await api(`/api/drafts/${d.id}`, { method: "PATCH", body: { action: "outcome", outcome: o } }); onDone(); }}>{o.replace("_", " ")}</button>
            ))}
          </span>
        )}
      </div>
      {msg && <div className="small" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

export default function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, reload, error } = useApi<Detail>(`/api/companies/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!d) return <><PageHead title="Account" /><main><Link href="/accounts">← All accounts</Link><p>{error || "Loading..."}</p></main></>;
  const { company: c, steps, drafts, checkpoints } = d;
  const f = c.fields ?? {};
  const sb = c.score_breakdown;
  const chosen = c.contact?.chosen;
  const totalTokens = steps.reduce((a, s) => a + (s.tokens ? 0 : 0), 0) + (c.tokens ?? 0);
  const cost = ((c.tokens ?? 0) / 1_000_000) * d.icp.usdPerMillionTokens;

  async function rerun(force: boolean) {
    setBusy(true); setMsg("Researching again...");
    try { const r = await api<{ result?: unknown }>("/api/run-company", { body: { id: c.id, force } }); setMsg(`Done: ${(r as any).status}`); } catch (e) { setMsg((e as Error).message); }
    await reload(); setBusy(false);
  }

  const ev = (label: string, e: { value: unknown; quote: string | null; url: string | null } | undefined) => (
    <tr key={label}><td>{label}</td><td>{e?.value === null || e?.value === undefined ? <span className="muted">unknown</span> : String(e.value)}</td>
      <td className="small muted">{e?.quote ? <>“{e.quote}” {e.url && <a href={e.url} target="_blank" rel="noreferrer">source</a>}</> : ""}</td></tr>
  );

  return (
    <>
      <PageHead
        back={<Link href="/accounts" className="back">← All accounts</Link>}
        title={c.name ?? c.domain}
        sub={<>{c.domain} · <StatusChip status={c.status} /> {c.reason && <span className="muted">({c.reason})</span>} · <Tier tier={c.tier} score={c.score} /> · {c.loop_fetches} extra fetches · {(c.tokens ?? 0).toLocaleString()} tokens (≈ ${cost.toFixed(4)}){c.duration_ms ? ` · ${(c.duration_ms / 1000).toFixed(0)}s` : ""}</>}
        right={<><button className="ghost" disabled={busy} onClick={() => rerun(false)}>Re-run</button>{c.status === "maybe" && <button disabled={busy} onClick={() => rerun(true)}>Qualify anyway</button>}</>}
      />
      <main>
        {msg && <div className="card small">{msg}</div>}
        {checkpoints.length > 0 && <div className="banner warn"><b>Needs you:</b> {checkpoints.map((k) => k.reason).join(" · ")} <Link href="/review">Open the Review queue →</Link></div>}
        {c.flags?.length > 0 && <div className="card">{c.flags.map((x: string) => <span className="flag" key={x}>⚑ {x}</span>)}</div>}

        <h2>Verdict: why this score</h2>
        <div className="card">
          {sb ? (<>
            <table><tbody>
              {sb.lines.map((l: any) => (
                <tr key={l.key}><td style={{ width: 210 }}>{l.label}</td><td className="nowrap"><b>{l.got}</b> <span className="muted">/ {l.max}</span></td>
                  <td style={{ width: "30%" }}><div className="bar"><span style={{ width: `${l.max ? (l.got / l.max) * 100 : 0}%` }} /></div></td><td className="small muted">{l.why}</td></tr>
              ))}
              {sb.penalties.map((p: any, i: number) => <tr key={i}><td>Penalty</td><td className="nowrap" style={{ color: "var(--bad)" }}><b>-{p.pts}</b></td><td></td><td className="small muted">{p.label}</td></tr>)}
            </tbody></table>
            <div className="small muted" style={{ marginTop: 6 }}>Scored by code from the evidence below with ICP version {c.icp_version ?? d.icp.version}. Change the weights on the ICP &amp; Rules page.</div>
          </>) : <span className="muted">No score yet (the company stopped before scoring: {c.reason ?? c.status}).</span>}
        </div>

        <h2>Facts and evidence</h2>
        <div className="card">
          <div className="small muted">Found via {c.source ?? "manual"}: “{c.discovery?.quote}” {c.discovery?.url && <a href={c.discovery.url} target="_blank" rel="noreferrer">source</a>}</div>
          <table style={{ marginTop: 8 }}><tbody>
            {ev("B2B SaaS", f.is_b2b_saas)}{ev("Buyer", f.buyer)}{ev("Funding stage", f.funding_stage)}
            {ev("Open roles", f.open_roles)}{ev("Compliance / security hiring", f.compliance_hiring)}{ev("Enterprise signal", f.enterprise_signal)}
            <tr><td>Certifications</td><td>{f.certifications?.length ? f.certifications.map((x: any) => x.name).join(", ") : <span className="muted">none found</span>}</td><td className="small muted">{f.certifications?.[0]?.quote}</td></tr>
          </tbody></table>
        </div>

        <h2>Why this person</h2>
        <div className="card">
          {chosen ? (<>
            <b>{chosen.first_name} {chosen.last_name}</b>, {chosen.position} <span className="muted small">({chosen.email}{chosen.confidence != null ? `, confidence ${chosen.confidence}` : ""}{chosen.verified ? ", verified" : ""})</span>
            <div className="small muted">{c.contact?.override ? "Chosen by you at the Review queue." : `Auto-accepted because: ${chosen.why?.join(", ")}`}</div>
          </>) : <span className="muted">No contact chosen yet.</span>}
        </div>

        <h2>Outreach</h2>
        {drafts.length ? drafts.map((dr) => <DraftEditor key={dr.id} d={dr} onDone={reload} />) : <div className="card muted">No draft for this company.</div>}

        <h2>Decision trail</h2>
        <div className="card">
          <div className="small muted">{steps.length} steps · {(c.tokens ?? 0).toLocaleString()} tokens · ≈ ${cost.toFixed(4)} (estimate at ${d.icp.usdPerMillionTokens}/1M tokens)</div>
          {steps.map((s) => (
            <details key={s.id}><summary><b>{s.step}</b> <span className="muted small">{new Date(s.created_at).toLocaleTimeString()}{s.tokens ? ` · ${s.tokens} tokens` : ""}</span></summary>
              <pre>{JSON.stringify(s.detail, null, 2)}</pre></details>
          ))}
        </div>
      </main>
    </>
  );
}
