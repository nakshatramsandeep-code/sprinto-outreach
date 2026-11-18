import { checkAccess } from "@/lib/auth";
import { discover } from "@/lib/discover";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  try {
    return Response.json(await discover());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
