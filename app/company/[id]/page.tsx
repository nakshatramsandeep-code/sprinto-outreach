"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Detail = {
  company: any;
  steps: { id: number; step: string; detail: any; tokens: number; created_at: string }[];
  draft: { id: number; subject: string; body: string; pains: { pain: string; evidence_field: string }[]; hook_field: string; validation: { ok: boolean; problems: string[] }; review_status: string } | null;
};

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>(`/api/companies/${id}`);
      setD(r);
      if (r.draft) { setSubject(r.draft.subject); setBody(r.draft.body); }
    } catch (e) { setMsg((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <main><Link href="/">← Back</Link><p>{msg || "Loading..."}</p></main>;
  const { company: c, steps, draft } = d;
  const f = c.fields ?? {};
  const locked = !draft || ["sent", "rejected", "sending"].includes(draft.review_status);
  const chosen = c.contact?.chosen;

  async function act(kind: "send" | "edit" | "reject") {
    if (!draft) return;
    setBusy(true); setMsg("");
    try {
      if (kind === "send") { await api("/api/send", { body: { draftId: draft.id, subject, body } }); setMsg("Sent to your own inbox."); }
      if (kind === "edit") { await api(`/api/drafts/${draft.id}`, { method: "PATCH", body: { action: "edit", subject, body } }); setMsg("Saved."); }
      if (kind === "reject") { await api(`/api/drafts/${draft.id}`, { method: "PATCH", body: { action: "reject" } }); setMsg("Rejected."); }
      await load();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  const ev = (label: string, e: { value: unknown; quote: string | null; url: string | null } | undefined) => (
    <tr key={label}><td>{label}</td><td>{e?.value === null || e?.value === undefined ? <span className="muted">unknown</span> : String(e.value)}</td>
      <td className="small muted">{e?.quote ? <>“{e.quote}” <a href={e.url ?? "#"} target="_blank" rel="noreferrer">source</a></> : ""}</td></tr>
  );

  return (
    <main>
      <Link href="/">← All companies</Link>
      <h1>{c.name ?? c.domain}</h1>
      <div className="sub">{c.domain} · <span className={`chip ${c.status}`}>{c.status.replace("_", " ")}</span> {c.reason && <span className="muted">({c.reason})</span>} · rank {c.rank ?? "-"} · {c.loop_fetches} extra fetches · {c.tokens} tokens</div>
      {c.flags?.length > 0 && <div className="card">{c.flags.map((x: string) => <span className="flag" key={x}>⚑ {x}</span>)}</div>}

      <h2>1. Why this company</h2>
      <div className="card">
        <div className="small muted">Discovered via {c.discovery?.source}: “{c.discovery?.quote}” {c.discovery?.url && <a href={c.discovery.url} target="_blank" rel="noreferrer">source</a>}</div>
        <table style={{ marginTop: 8 }}><tbody>
          {ev("B2B SaaS", f.is_b2b_saas)}{ev("Buyer", f.buyer)}{ev("Funding stage", f.funding_stage)}
          {ev("Open roles", f.open_roles)}{ev("Enterprise signal", f.enterprise_signal)}
          <tr><td>Certifications</td><td>{f.certifications?.length ? f.certifications.map((x: any) => x.name).join(", ") : <span className="muted">none found</span>}</td><td className="small muted">{f.certifications?.[0]?.quote}</td></tr>
        </tbody></table>
      </div>

      <h2>2. Why this person</h2>
      <div className="card">
        {chosen ? (<>
          <b>{chosen.first_name} {chosen.last_name}</b>, {chosen.position} <span className="muted small">({chosen.email}, confidence {chosen.confidence ?? "?"}{chosen.verified ? ", verified" : ""})</span>
          <div className="small muted">Ranked because: {chosen.why?.join(", ")}</div>
        </>) : <span className="muted">No contact chosen.</span>}
      </div>

      <h2>3. Why this email</h2>
      {draft ? (
        <div className="card">
          <div className="small"><b>Pain points:</b><ul>{draft.pains?.map((p, i) => <li key={i}>{p.pain} <span className="muted">(evidence: {p.evidence_field})</span></li>)}</ul>
            <b>Hook based on:</b> {draft.hook_field}</div>
          {!draft.validation?.ok && <div className="small" style={{ color: "var(--warn)" }}>Validator problems: {draft.validation?.problems?.join("; ")}</div>}
          <div style={{ marginTop: 10 }}>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} />
            <textarea style={{ marginTop: 8 }} value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={busy || locked} onClick={() => act("send")}>Approve &amp; send to my inbox</button>
            <button className="ghost" disabled={busy || locked} onClick={() => act("edit")}>Save edit</button>
            <button className="danger" disabled={busy || locked} onClick={() => act("reject")}>Reject</button>
            <span className="muted small">Status: {draft.review_status}</span>
          </div>
          {msg && <div className="small" style={{ marginTop: 8 }}>{msg}</div>}
        </div>
      ) : <div className="card muted">No draft for this company.</div>}

      <h2>Decision log</h2>
      <div className="card">
        {steps.map((s) => (
          <details key={s.id}><summary><b>{s.step}</b> <span className="muted small">{new Date(s.created_at).toLocaleTimeString()}{s.tokens ? ` · ${s.tokens} tokens` : ""}</span></summary>
            <pre>{JSON.stringify(s.detail, null, 2)}</pre></details>
        ))}
      </div>
    </main>
  );
}
