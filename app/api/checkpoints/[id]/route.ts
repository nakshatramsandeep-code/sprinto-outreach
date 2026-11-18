import { route, bad, idOf, readJson } from "@/lib/api";
import { q } from "@/lib/db";
import { runCompany, continueWithContact } from "@/lib/pipeline";
import { sendDraft } from "@/lib/send";
import { audit, openCheckpoint, KIND_CODE, type CheckpointKind } from "@/lib/settings";
import type { Ranked } from "@/lib/rank";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

type Body = {
  action?: string; reason?: string; url?: string; subject?: string; body?: string; index?: number;
  first_name?: string; last_name?: string; email?: string; title?: string;
};
type Cp = { id: number; company_id: number; kind: CheckpointKind; reason: string; data: { top?: Ranked[]; best?: Ranked | null; day?: number }; status: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function resolve(cp: Cp, status: string, resolution: Record<string, unknown>) {
  await q("UPDATE checkpoints SET status=$2, resolution=$3, resolved_at=now() WHERE id=$1 AND status='open'", [cp.id, status, JSON.stringify(resolution)]);
  await audit("owner", `${KIND_CODE[cp.kind]} ${resolution.action ?? status}`, { checkpoint: cp.id, company: cp.company_id, reason: cp.reason, ...resolution });
}

export const POST = route(async (req, ctx) => {
  const id = await idOf(ctx);
  const b = await readJson<Body>(req);
  const cp = (await q<Cp>("SELECT id, company_id, kind, reason, data, status FROM checkpoints WHERE id=$1", [id]))[0];
  if (!cp) return bad("checkpoint not found", 404);
  if (cp.status !== "open") return bad("this checkpoint is already answered", 409);
  const a = b.action ?? "";
  const cid = cp.company_id;

  if (a === "skip") { await resolve(cp, "skipped", { action: "skip" }); return { ok: true }; }

  if (cp.kind === "qualification") {
    if (a === "disqualify") {
      const reason = (b.reason ?? "other").slice(0, 60);
      await q("UPDATE companies SET status='disqualified', reason=$2, updated_at=now() WHERE id=$1", [cid, reason]);
      await resolve(cp, "resolved", { action: "disqualify", reason });
      return { ok: true };
    }
    if (a === "qualify" || a === "retry") {
      await resolve(cp, "resolved", { action: a });
      const r = await runCompany(cid, { force: a === "qualify" });
      return { ok: true, result: r };
    }
    if (a === "add_url") {
      let u: URL;
      try { u = new URL(b.url ?? ""); } catch { return bad("enter a full URL starting with https://"); }
      if (u.protocol !== "https:" && u.protocol !== "http:") return bad("URL must be http(s)");
      await q("UPDATE companies SET extra_urls = array_append(extra_urls, $2) WHERE id=$1", [cid, u.toString()]);
      await resolve(cp, "resolved", { action: "add_url", url: u.toString() });
      const r = await runCompany(cid);
      return { ok: true, result: r };
    }
  }

  if (cp.kind === "contact") {
    let person: Ranked | null = null;
    if (a === "use_best") person = cp.data.best ?? cp.data.top?.[0] ?? null;
    if (a === "pick") person = cp.data.top?.[b.index ?? 0] ?? null;
    if (a === "manual") {
      if (!b.first_name?.trim() || !b.email || !EMAIL_RE.test(b.email)) return bad("first name and a valid email are required");
      person = {
        email: b.email.trim(), first_name: b.first_name.trim(), last_name: b.last_name?.trim() || null, position: b.title?.trim() || "Decision maker",
        seniority: null, department: null, confidence: null, verified: false, score: 0, why: ["entered by hand"],
      };
    }
    if (person) {
      await resolve(cp, "resolved", { action: a, person: `${person.first_name} ${person.last_name ?? ""} (${person.position})` });
      const d = await continueWithContact(cid, person, true);
      return { ok: true, draft: d };
    }
  }

  if (cp.kind === "angle") {
    if (a === "confirm") {
      await resolve(cp, "resolved", { action: "confirm hook" });
      await openCheckpoint(cid, "send", "draft ready: approve & send", {});
      return { ok: true };
    }
  }

  if (cp.kind === "send") {
    const kind = cp.data.day ? `followup_${cp.data.day}` : "first";
    const d = (await q<{ id: number }>("SELECT id FROM drafts WHERE company_id=$1 AND kind=$2", [cid, kind]))[0];
    if (!d) return bad("no draft for this checkpoint", 404);
    if (a === "approve") {
      const r = await sendDraft(d.id, { subject: b.subject, body: b.body });
      if (!r.ok) return bad(r.error, r.status);
      await resolve(cp, "resolved", { action: "approve & send", draft: d.id });
      return { ok: true, messageId: r.messageId };
    }
  }

  if (cp.kind === "system" && a === "dismiss") { await resolve(cp, "resolved", { action: "dismiss" }); return { ok: true }; }

  return bad("that action does not apply to this checkpoint");
});
