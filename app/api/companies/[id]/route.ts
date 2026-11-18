import { checkAccess } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const company = (await q("SELECT * FROM companies WHERE id=$1", [id]))[0];
  if (!company) return Response.json({ error: "not found" }, { status: 404 });
  const steps = await q("SELECT id, step, detail, tokens, created_at FROM steps WHERE company_id=$1 ORDER BY id", [id]);
  const draft = (await q("SELECT * FROM drafts WHERE company_id=$1", [id]))[0] ?? null;
  return Response.json({ company, steps, draft });
}
