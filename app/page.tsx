"use client";

import Link from "next/link";
import { PageHead, useApi, useRunner, LogBox, Tier, ago } from "@/components/ui";

type Home = {
  kpis: { draftsReady: number; sentWeek: number; replyRate: number; minutesPerCompany: number; needsYou: number };
  funnel: { found: number; scraped: number; qualified: number; contact: number; drafts: number; sent: number };
  lastRun: string | null;
  activity: { id: number; step: string; detail: Record<string, any>; created_at: string; company_id: number; company: string }[];
  waiting: { id: number; company_id: number; subject: string; kind: string; name: string | null; domain: string; score: number | null; tier: string | null; fn: string | null; ln: string | null }[];
};

function describe(a: Home["activity"][number]): string {
  const d = a.detail;
  if (a.step === "score") return `score ${d.score} · tier ${d.tier}`;
  if (a.step === "decision") return d.outcome === "qualified" ? `qualified (rank ${d.rank})` : `${d.outcome}: ${d.reason}`;
  if (a.step === "contact") return d.chosen ? `contact: ${d.chosen.first_name} ${d.chosen.last_name ?? ""}, ${d.chosen.position}` : `contact: none auto-accepted (${d.found} found)`;
  if (a.step === "draft") return `draft written, hook: ${d.hook_field}`;
  if (a.step === "send") return `sent to demo inbox${d.edited ? " (edited)" : ""}`;
  if (a.step === "scrape_failed") return `could not read site: ${d.reason}`;
  return a.step;
}

export default function Home() {
  const { data, reload, error } = useApi<Home>("/api/home");
  const { busy, log, run, stop } = useRunner(reload);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const k = data?.kpis;
  const f = data?.funnel;
  const steps = f ? [["1 · Found", f.found], ["2 · Scraped", f.scraped], ["3 · Qualified", f.qualified], ["4 · Contact found", f.contact], ["5 · Drafts", f.drafts], ["6 · Sent", f.sent]] as const : [];

  return (
    <>
      <PageHead
        title={<>{greet}. <span className="accent">Here is today.</span></>}
        sub={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        right={<>
          <button onClick={() => run("all")} disabled={busy}>{busy ? "Running..." : "Run"}</button>
          {busy && <button className="ghost" onClick={stop}>Stop</button>}
        </>}
      />
      <main>
        {error && <div className="card" style={{ borderColor: "var(--bad)" }}>Error: {error}</div>}
        <LogBox log={log} />

        <div className="grid kpis">
          <div className="kpi"><div className="label">Drafts ready</div><div className="value">{k?.draftsReady ?? "-"}</div><div className="note">Waiting for your approval</div></div>
          <div className="kpi"><div className="label">Sent this week</div><div className="value">{k?.sentWeek ?? "-"}</div><div className="note">Approved and sent via Resend</div></div>
          <div className="kpi"><div className="label">Reply rate</div><div className="value">{k ? `${k.replyRate}%` : "-"}</div><div className="note">Replies / sent, last 7 days</div></div>
          <div className="kpi"><div className="label">Minutes per company</div><div className="value">{k?.minutesPerCompany ?? "-"}</div><div className="note">vs 15-20 min done by hand</div></div>
          <div className={`kpi ${k && k.needsYou > 0 ? "warn" : ""}`}><div className="label">Needs you</div><div className="value">{k?.needsYou ?? "-"}</div><div className="note"><Link href="/review">Open checkpoints in the Review queue</Link></div></div>
        </div>

        <h2>Today&apos;s run</h2>
        <div className="grid kpis">
          {steps.map(([label, n]) => <div className="kpi" key={label}><div className="label">{label}</div><div className="value" style={{ fontSize: 26 }}>{n}</div></div>)}
        </div>
        <p className="muted small">Last discovery {data?.lastRun ? `${ago(data.lastRun)} ago` : "never"}. Runs are started with the Run button (no schedule). See the <Link href="/pipeline">pipeline</Link>.</p>

        <div className="split" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <h2>Recent activity</h2>
            <div className="list">
              {(data?.activity ?? []).length === 0 && <div className="item muted">Nothing yet. Press Run.</div>}
              {data?.activity.map((a) => (
                <Link key={a.id} href={`/accounts/${a.company_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="item"><b>{a.company}</b> <span className="muted small">· {describe(a)}</span><span className="muted small right" style={{ float: "right" }}>{ago(a.created_at)}</span></div>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h2>Drafts waiting for you</h2>
            <div className="list">
              {(data?.waiting ?? []).length === 0 && <div className="item muted">No drafts waiting.</div>}
              {data?.waiting.map((w) => (
                <Link key={w.id} href={`/accounts/${w.company_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="item"><b>{w.name ?? w.domain}</b> <Tier tier={w.tier} score={w.score} /><div className="small muted">{w.kind !== "first" ? `${w.kind.replace("_", " ")} · ` : ""}{w.subject} {w.fn ? `· to ${w.fn} ${w.ln ?? ""}` : ""}</div></div>
                </Link>
              ))}
            </div>
            <p><Link className="btn ghost" href="/outreach">Open Outreach</Link></p>
          </div>
        </div>
      </main>
    </>
  );
}
