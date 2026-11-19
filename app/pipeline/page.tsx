"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { PageHead, useApi, Tier } from "@/components/ui";

type Card = { draft_id: number; company_id: number; kind: string; review_status: string; outcome: string | null; sent_at: string | null; subject: string; days_since: number | null; company: string; score: number | null; tier: string | null; fn: string | null; ln: string | null };
type Resp = {
  cards: Card[];
  followUps: { company_id: number; company: string; person: string; day: number; days_since: number; sent_at: string }[];
  metrics: { qualified: number; contacted: number; openRate: number | null; replied: number; meetings: number; responseRate: number; followUpsDue: number };
};

export default function Pipeline() {
  const { data, reload, error } = useApi<Resp>("/api/pipeline");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const m = data?.metrics;
  const cards = data?.cards ?? [];

  // A company appears in ONE column. First emails waiting for approval are "Ready to send"; follow-up drafts (the first email is
  // already out) are listed with the follow-up queue below instead of a second column.
  const ready = cards.filter((c) => ["pending", "edited"].includes(c.review_status) && c.kind === "first");
  const followDrafts = cards.filter((c) => ["pending", "edited"].includes(c.review_status) && c.kind !== "first");
  const sent = cards.filter((c) => c.review_status === "sent" && c.kind === "first");
  const col = {
    awaiting: sent.filter((c) => !c.outcome), replied: sent.filter((c) => c.outcome === "replied"),
    meeting: sent.filter((c) => c.outcome === "meeting"), none: sent.filter((c) => c.outcome === "no_reply"),
  };

  async function mark(id: number, outcome: string) {
    await api(`/api/drafts/${id}`, { method: "PATCH", body: { action: "outcome", outcome } });
    reload();
  }
  async function draft(body: Record<string, unknown>, key: string) {
    setBusy(key); setMsg("");
    try { const r = await api<{ drafted: number }>("/api/followups", { body }); setMsg(`Drafted ${r.drafted} follow-up(s). Approve them in the Review queue.`); } catch (e) { setMsg((e as Error).message); }
    setBusy(""); reload();
  }

  const who = (c: Card) => c.fn ? `${c.fn} ${c.ln ?? ""}` : "";
  const Mini = ({ c, children }: { c: Card; children?: React.ReactNode }) => (
    <div className="cardlet">
      <Link href={`/accounts/${c.company_id}`}><b>{c.company}</b></Link> <Tier tier={c.tier} score={c.score} />
      <div className="muted small">{who(c)}{c.days_since != null && c.sent_at ? ` · sent ${c.days_since}d ago` : ""}</div>
      {children}
    </div>
  );

  return (
    <>
      <PageHead title="Pipeline" sub="From qualified to sent to replied. Emails go to the demo inbox, so you record the outcome yourself." />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        <div className="grid kpis">
          <div className="kpi"><div className="label">Qualified</div><div className="value">{m?.qualified ?? "-"}</div></div>
          <div className="kpi"><div className="label">Contacted</div><div className="value">{m?.contacted ?? "-"}</div><div className="note">companies with a first email sent</div></div>
          {m?.openRate != null && <div className="kpi"><div className="label">Open rate</div><div className="value">{m.openRate}%</div><div className="note">from Resend events</div></div>}
          <div className="kpi"><div className="label">Replied</div><div className="value">{m?.replied ?? "-"}</div></div>
          <div className="kpi"><div className="label">Meetings</div><div className="value">{m?.meetings ?? "-"}</div></div>
          <div className="kpi"><div className="label">Response rate</div><div className="value">{m ? `${m.responseRate}%` : "-"}</div></div>
          <div className={`kpi ${m && m.followUpsDue ? "warn" : ""}`}><div className="label">Follow-ups due</div><div className="value">{m?.followUpsDue ?? "-"}</div></div>
        </div>

        <h2>Deals</h2>
        <div className="kanban">
          <div className="col"><h3>Ready to send <span className="pill">{ready.length}</span></h3>
            {ready.map((c) => <Mini key={c.draft_id} c={c}><div className="small muted">first email, waiting for your approval</div></Mini>)}</div>
          <div className="col"><h3>Awaiting reply <span className="pill">{col.awaiting.length}</span></h3>
            {col.awaiting.map((c) => <Mini key={c.draft_id} c={c}>
              <div className="row" style={{ marginTop: 6, gap: 6 }}>
                {[["replied", "Replied"], ["meeting", "Meeting"], ["no_reply", "No reply"]].map(([o, l]) => <button key={o} className="ghost" style={{ padding: "3px 10px", fontSize: 12.5 }} onClick={() => mark(c.draft_id, o)}>{l}</button>)}
              </div></Mini>)}</div>
          <div className="col"><h3>Replied <span className="pill ok">{col.replied.length}</span></h3>{col.replied.map((c) => <Mini key={c.draft_id} c={c} />)}</div>
          <div className="col"><h3>Meeting <span className="pill ok">{col.meeting.length}</span></h3>{col.meeting.map((c) => <Mini key={c.draft_id} c={c} />)}</div>
          <div className="col"><h3>No reply <span className="pill">{col.none.length}</span></h3>{col.none.map((c) => <Mini key={c.draft_id} c={c} />)}</div>
        </div>

        <h2>Follow-up queue</h2>
        <div className="card">
          <div className="row small muted"><span>Cadence: day 3, 7 and 14 after the first email, if nobody has replied. Change it on ICP &amp; Rules.</span>
            <button className="right" disabled={!!busy || !data?.followUps.length} onClick={() => draft({ all: true }, "all")}>{busy === "all" ? "Drafting..." : "Draft all due"}</button></div>
          {msg && <div className="small" style={{ margin: "8px 0" }}>{msg}</div>}
          {followDrafts.length > 0 && (
            <div style={{ margin: "8px 0" }}>
              <b className="small">Follow-up drafts waiting for your approval</b>
              {followDrafts.map((c) => (
                <div className="row cardlet" key={c.draft_id}>
                  <Link href={`/accounts/${c.company_id}`}><b>{c.company}</b></Link><span className="muted small">{who(c)}</span><span className="pill warn">{c.kind.replace("followup_", "Day ")}</span>
                  <Link className="btn ghost right" href="/review" style={{ padding: "4px 14px" }}>Review</Link>
                </div>
              ))}
            </div>
          )}
          {(data?.followUps ?? []).length === 0 && followDrafts.length === 0 && <p className="muted">No follow-ups due.</p>}
          {data?.followUps.map((f) => (
            <div className="row cardlet" key={`${f.company_id}-${f.day}`}>
              <b>{f.company}</b><span className="muted small">{f.person}</span><span className="pill warn">Day {f.day}</span><span className="muted small">sent {f.days_since}d ago</span>
              <button className="ghost right" disabled={!!busy} onClick={() => draft({ companyId: f.company_id, day: f.day }, String(f.company_id))}>{busy === String(f.company_id) ? "Drafting..." : "Draft now"}</button>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
