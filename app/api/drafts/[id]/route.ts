import { route, bad, idOf, readJson } from "@/lib/api";
import { q } from "@/lib/db";
import { audit, closeCheckpoints } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Save an edit, reject a draft, or record what happened after sending. Sent drafts are locked (except outcome).
export const PATCH = route(async (req, ctx) => {
  const id = await idOf(ctx);
  const b = await readJson<{ action?: string; subject?: string; body?: string; outcome?: string }>(req);
  if (!Number.isInteger(id)) return bad("bad id");

  if (b.action === "reject") {
    const r = await q<{ company_id: number }>("UPDATE drafts SET review_status='rejected' WHERE id=$1 AND review_status IN ('pending','edited') RETURNING company_id", [id]);
    if (!r.length) return bad("draft is locked or missing", 409);
    await closeCheckpoints(r[0].company_id, ["send", "angle"], "resolved", { rejected: true });
    await audit("owner", "reject draft", { draft: id });
    return { ok: true };
  }
  if (b.action === "edit" && typeof b.subject === "string" && typeof b.body === "string") {
    const r = await q("UPDATE drafts SET subject=$2, body=$3, review_status='edited' WHERE id=$1 AND review_status IN ('pending','edited') RETURNING id", [id, b.subject.slice(0, 200), b.body.slice(0, 5000)]);
    if (!r.length) return bad("draft is locked or missing", 409);
    await audit("owner", "edit draft", { draft: id });
    return { ok: true };
  }
  if (b.action === "outcome" && ["replied", "meeting", "no_reply"].includes(b.outcome ?? "")) {
    const r = await q("UPDATE drafts SET outcome=$2, outcome_at=now() WHERE id=$1 AND review_status='sent' RETURNING id", [id, b.outcome]);
    if (!r.length) return bad("only sent emails can have an outcome", 409);
    await audit("owner", `mark ${b.outcome}`, { draft: id });
    return { ok: true };
  }
  return bad("bad request");
});
