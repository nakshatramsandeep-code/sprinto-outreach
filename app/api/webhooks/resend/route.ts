import { createHmac, timingSafeEqual } from "node:crypto";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Resend (Svix) webhook: records delivered / opened / clicked / bounced so the Pipeline can show an open rate.
// Not behind the access key (Resend cannot send one); protected by Svix signature verification instead.
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook not configured" }, { status: 503 });

  const payload = await req.text();
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sigHeader = req.headers.get("svix-signature") ?? "";
  if (!id || !ts || !sigHeader) return Response.json({ error: "missing signature" }, { status: 400 });
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return Response.json({ error: "stale timestamp" }, { status: 400 });

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  const ok = sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1] ?? "";
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
  if (!ok) return Response.json({ error: "bad signature" }, { status: 401 });

  const evt = JSON.parse(payload) as { type?: string; data?: { email_id?: string } };
  if (evt.type?.startsWith("email.") && evt.data?.email_id) {
    const d = await q<{ id: number }>("SELECT id FROM drafts WHERE message_id=$1", [evt.data.email_id]);
    if (d[0]) await q("INSERT INTO email_events (draft_id, type, raw) VALUES ($1,$2,$3)", [d[0].id, evt.type, payload]);
  }
  return Response.json({ ok: true });
}
