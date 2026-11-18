import { checkAccess } from "@/lib/auth";
import { runCompany } from "@/lib/pipeline";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!Number.isInteger(id)) return Response.json({ error: "id required" }, { status: 400 });
  try {
    return Response.json(await runCompany(id as number));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
