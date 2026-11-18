"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { PageHead, useApi, Tier, ago } from "@/components/ui";

type Item = {
  id: number; kind: "qualification" | "contact" | "angle" | "send" | "system"; reason: string; data: any; created_at: string;
  company_id: number | null; company: string; domain: string | null; score: number | null; tier: string | null;
  fields: any; contact: any; discovery: any; draft_id: number | null;
};
type Resp = { items: Item[]; drafts: { id: number; subject: string; body: string; kind: string }[]; hunterLeft: number; log: { id: number; actor: string; action: string; detail: any; created_at: string }[] };

const CODE = { qualification: "H2", contact: "H3", angle: "H4", send: "H5", system: "H7" } as const;
const TABS: { key: string; label: string; match: (i: Item) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "qualification", label: "Qualification", match: (i) => i.kind === "qualification" },
  { key: "contact", label: "Contact", match: (i) => i.kind === "contact" },
  { key: "angle", label: "Angle", match: (i) => i.kind === "angle" },
  { key: "send", label: "Ready to send", match: (i) => i.kind === "send" && !i.data?.day },
  { key: "followup", label: "Follow-ups", match: (i) => i.kind === "send" && !!i.data?.day },
  { key: "system", label: "System", match: (i) => i.kind === "system" },
];
const REASONS = ["already certified", "not SaaS", "too small", "too large", "other"];

export default function Review() {
  const { data, reload, error } = useApi<Resp>("/api/review");
  const [tab, setTab] = useState("all");
  const [sel, setSel] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => (data?.items ?? []).filter((TABS.find((t) => t.key === tab) ?? TABS[0]).match), [data, tab]);
  const cur = items.find((i) => i.id === sel) ?? items[0] ?? null;
  const draft = cur?.draft_id ? data?.drafts.find((d) => d.id === cur.draft_id) : undefined;

  // form state for the selected item
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [url, setUrl] = useState("");
  const [man, setMan] = useState({ first_name: "", last_name: "", title: "", email: "" });
  const [why, setWhy] = useState("");
  useEffect(() => { setSubject(draft?.subject ?? ""); setBody(draft?.body ?? ""); setMsg(""); setUrl(""); }, [cur?.id, draft?.id]);

  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!cur) return;
    setBusy(true); setMsg("Working...");
    try {
      await api(`/api/checkpoints/${cur.id}`, { body: { action, ...extra } });
      setMsg("Done.");
      await reload();
      window.dispatchEvent(new Event("checkpoints-changed")); // keeps the nav badge in step
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }, [cur, reload]);

  // keyboard: j/k move, a approve/confirm, s skip, e open account
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey) return;
      const idx = items.findIndex((i) => i.id === cur?.id);
      if (e.key === "j") setSel(items[Math.min(items.length - 1, idx + 1)]?.id ?? null);
      if (e.key === "k") setSel(items[Math.max(0, idx - 1)]?.id ?? null);
      if (e.key === "s" && cur && !busy) act("skip");
      if (e.key === "e" && cur?.company_id) window.location.href = `/accounts/${cur.company_id}`;
      if (e.key === "a" && cur && !busy) {
        if (cur.kind === "send") act("approve", { subject, body });
        else if (cur.kind === "angle") act("confirm");
        else if (cur.kind === "contact" && (cur.data?.best || cur.data?.top?.length)) act("use_best");
        else if (cur.kind === "qualification" && cur.reason.includes("maybe band")) act("qualify");
        else if (cur.kind === "system") act("dismiss");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cur, busy, act, subject, body]);

  const count = (m: (i: Item) => boolean) => (data?.items ?? []).filter(m).length;
  const f = cur?.fields ?? {};

  return (
    <>
      <PageHead title="Review queue" sub={<>Every checkpoint that needs a human, with the evidence beside the decision. Hunter: {data?.hunterLeft ?? "-"} searches left this month.</>} />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        <div className="tabs">
          {TABS.map((t) => <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}<span className="n">{count(t.match)}</span></button>)}
        </div>
        <p className="muted small">Keyboard: j/k move · a approve/confirm · s skip · e open account</p>

        <div className="split">
          <div className="list">
            {items.length === 0 && <div className="item muted">Nothing needs you right now.</div>}
            {items.map((i) => (
              <div key={i.id} className={`item ${cur?.id === i.id ? "sel" : ""}`} onClick={() => setSel(i.id)}>
                <div><span className="kind">{CODE[i.kind]}</span><b>{i.company}</b> <span className="muted small right" style={{ float: "right" }}>{ago(i.created_at)}</span></div>
                <div className="small muted">{i.data?.day ? `follow-up day ${i.data.day}: ` : ""}{i.reason}</div>
              </div>
            ))}
          </div>

          <div>
            {!cur ? <div className="card muted">Select an item.</div> : (
              <div className="card">
                <div className="row">
                  <h2 style={{ margin: 0 }}>{cur.company}</h2>
                  <span className="kind">{CODE[cur.kind]}</span>
                  {cur.tier && <Tier tier={cur.tier} score={cur.score} />}
                  {cur.company_id && <Link className="right small" href={`/accounts/${cur.company_id}`}>Open account →</Link>}
                </div>
                <div className="banner warn" style={{ marginTop: 10 }}><b>Why it's here:</b> {cur.reason}</div>

                {cur.company_id && cur.kind !== "system" && (
                  <div className="small" style={{ marginBottom: 12 }}>
                    <b>Key facts</b>
                    <div className="muted">
                      Stage: {f.funding_stage?.value ?? cur.discovery?.stage ?? "unknown"} · Buyer: {f.buyer?.value ?? "unknown"} · B2B SaaS: {String(f.is_b2b_saas?.value ?? "unknown")} · Open roles: {f.open_roles?.value ?? "unknown"} · Certifications: {f.certifications?.length ? f.certifications.map((x: any) => x.name).join(", ") : "none found"}
                    </div>
                    {cur.discovery?.quote && <div className="muted">Surfaced by: “{cur.discovery.quote}”</div>}
                  </div>
                )}

                {cur.kind === "qualification" && (<>
                  <p className="small muted">This checkpoint always needs an explicit choice.</p>
                  <div className="row">
                    {cur.reason.includes("maybe band") && <button disabled={busy} onClick={() => act("qualify")}>Qualify anyway</button>}
                    <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "auto", padding: 9, borderRadius: 12, border: "1px solid var(--line)" }}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                    <button className="danger" disabled={busy} onClick={() => act("disqualify", { reason })}>Disqualify</button>
                    <button className="ghost" disabled={busy} onClick={() => act("retry")}>Retry</button>
                    <button className="ghost" disabled={busy} onClick={() => act("skip")}>Skip</button>
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <input placeholder="Add a page to read, e.g. https://company.com/security" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
                    <button className="ghost" disabled={busy || !url} onClick={() => act("add_url", { url })}>Add URL &amp; retry</button>
                  </div>
                </>)}

                {cur.kind === "contact" && (<>
                  {(cur.data?.top ?? []).length > 0 && <>
                    <b className="small">Candidates from Hunter</b>
                    {(cur.data.top as any[]).map((p, i) => (
                      <div className="cardlet" key={i}>
                        <div className="row"><b>{p.first_name} {p.last_name}</b><span className="muted">{p.position}</span><span className="pill">score {p.score}</span>{p.verified && <span className="pill ok">verified</span>}
                          <button className="ghost right" disabled={busy} style={{ padding: "4px 14px" }} onClick={() => act("pick", { index: i, why })}>Use this person</button></div>
                        <div className="small muted">{p.email} · {p.why?.join(", ")}</div>
                      </div>
                    ))}
                  </>}
                  <div className="row small" style={{ margin: "8px 0" }}>
                    <span className="muted">If you replace our pick, why? (helps the system learn)</span>
                    <select value={why} onChange={(e) => setWhy(e.target.value)} style={{ width: "auto", padding: 7, borderRadius: 10, border: "1px solid var(--line)" }}>
                      <option value="">no reason</option><option>wrong role</option><option>left the company</option><option>bad email</option><option>better fit</option><option>other</option>
                    </select>
                  </div>
                  <b className="small">Or enter a contact by hand</b>
                  <div className="formgrid" style={{ margin: "8px 0" }}>
                    {(["first_name", "last_name", "title", "email"] as const).map((k) => <input key={k} placeholder={k.replace("_", " ")} value={man[k]} onChange={(e) => setMan({ ...man, [k]: e.target.value })} />)}
                  </div>
                  <div className="row">
                    <button disabled={busy || !man.first_name || !man.email} onClick={() => act("manual", { ...man, why })}>Use these details</button>
                    <button className="ghost" disabled={busy} onClick={() => act("skip")}>Skip</button>
                  </div>
                </>)}

                {cur.kind === "angle" && (<>
                  {draft ? <><pre>{draft.subject + "\n\n" + draft.body}</pre></> : <p className="muted">No draft text found.</p>}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button disabled={busy} onClick={() => act("confirm")}>The hook is fine, continue</button>
                    <button className="ghost" disabled={busy} onClick={() => act("skip")}>Skip</button>
                  </div>
                </>)}

                {cur.kind === "send" && (<>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} />
                  <textarea style={{ marginTop: 8 }} value={body} onChange={(e) => setBody(e.target.value)} />
                  <div className="row" style={{ marginTop: 10 }}>
                    <button disabled={busy || !draft} onClick={() => act("approve", { subject, body })}>Approve &amp; send to demo inbox</button>
                    <button className="ghost" disabled={busy} onClick={() => act("skip")}>Skip</button>
                  </div>
                </>)}

                {cur.kind === "system" && <div className="row"><button disabled={busy} onClick={() => act("dismiss")}>Dismiss</button></div>}
                {msg && <div className="small" style={{ marginTop: 10 }}>{msg}</div>}
              </div>
            )}
          </div>
        </div>

        <h2>ICP log</h2>
        <div className="card small">
          {(data?.log ?? []).length === 0 && <span className="muted">No decisions logged yet.</span>}
          {data?.log.map((l) => <div key={l.id}><span className="muted">{new Date(l.created_at).toLocaleString("en-IN")}</span> · <b>{l.actor}</b> · {l.action}{l.detail?.reason ? ` · “${l.detail.reason}”` : ""}</div>)}
        </div>
      </main>
    </>
  );
}
