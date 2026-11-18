import { route, bad, readJson } from "@/lib/api";
import { sendDraft } from "@/lib/send";

export const dynamic = "force-dynamic";

// The only human gate: nothing is sent until the Growth Lead presses Approve & Send.
export const POST = route(async (req) => {
  const { draftId, subject, body } = await readJson<{ draftId?: number; subject?: string; body?: string }>(req);
  if (!Number.isInteger(draftId)) return bad("draftId required");
  const r = await sendDraft(draftId as number, { subject, body });
  return r.ok ? { ok: true, messageId: r.messageId } : bad(r.error, r.status);
});
