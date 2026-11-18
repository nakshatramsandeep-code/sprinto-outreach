"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHead, useApi, Tier, ago } from "@/components/ui";

type D = { id: number; company_id: number; kind: string; subject: string; review_status: string; edited: boolean; created_at: string; sent_at: string | null; name: string | null; domain: string; score: number | null; tier: string | null; fn: string | null; ln: string | null; title: string | null };

export default function Outreach() {
  const { data, error } = useApi<{ drafts: D[] }>("/api/drafts");
  const [f, setF] = useState("waiting");
  const all = data?.drafts ?? [];
  const match = (d: D, k: string) => k === "all" || (k === "waiting" ? ["pending", "edited"].includes(d.review_status) : d.review_status === k);
  const rows = all.filter((d) => match(d, f));
  return (
    <>
      <PageHead title="Outreach" sub="Every draft email. Open one to read the reasons, edit it, and approve." />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        <div className="tabs">
          {[["waiting", "Waiting"], ["sent", "Sent"], ["rejected", "Rejected"], ["all", "All"]].map(([k, l]) => <button key={k} className={f === k ? "on" : ""} onClick={() => setF(k)}>{l}<span className="n">{all.filter((d) => match(d, k)).length}</span></button>)}
        </div>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead><tr><th>Company</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No drafts here.</td></tr>}
              {rows.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.name ?? d.domain}</b> <Tier tier={d.tier} score={d.score} /></td>
                  <td className="small">{d.fn ? `${d.fn} ${d.ln ?? ""}` : "-"}<div className="muted">{d.title}</div></td>
                  <td className="small">{d.kind !== "first" && <span className="pill">{d.kind.replace("_", " ")}</span>} {d.subject}</td>
                  <td><span className="pill">{d.review_status}{d.edited ? " · edited" : ""}</span><div className="muted small">{ago(d.sent_at ?? d.created_at)}</div></td>
                  <td><Link className="btn ghost" href={`/accounts/${d.company_id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
