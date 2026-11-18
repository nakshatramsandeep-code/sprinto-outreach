import { checkAccess } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Save an edit or reject a draft. Sent drafts are locked.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as { action?: string; subject?: string; body?: string };
  if (!Number.isInteger(id)) return Response.json({ error: "bad id" }, { status: 400 });

  if (b.action === "reject") {
    const r = await q("UPDATE drafts SET review_status='rejected' WHERE id=$1 AND review_status IN ('pending','edited') RETURNING id", [id]);
    return r.length ? Response.json({ ok: true }) : Response.json({ error: "draft is locked or missing" }, { status: 409 });
  }
  if (b.action === "edit" && typeof b.subject === "string" && typeof b.body === "string") {
    const r = await q("UPDATE drafts SET subject=$2, body=$3, review_status='edited' WHERE id=$1 AND review_status IN ('pending','edited') RETURNING id", [id, b.subject.slice(0, 200), b.body.slice(0, 5000)]);
    return r.length ? Response.json({ ok: true }) : Response.json({ error: "draft is locked or missing" }, { status: 409 });
  }
  return Response.json({ error: "bad request" }, { status: 400 });
}
