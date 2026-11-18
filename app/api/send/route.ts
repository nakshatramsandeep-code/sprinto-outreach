import { checkAccess } from "@/lib/auth";
import { q, logStep } from "@/lib/db";
import { sendToOwner } from "@/lib/mailer";

export const dynamic = "force-dynamic";

type Row = { id: number; company_id: number; subject: string; body: string; review_status: string };

// The only human gate: nothing is sent until the Growth Lead presses Approve & Send.
export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const { draftId, subject, body } = (await req.json().catch(() => ({}))) as { draftId?: number; subject?: string; body?: string };
  if (!Number.isInteger(draftId)) return Response.json({ error: "draftId required" }, { status: 400 });

  // Atomic claim: flips to 'sending' only once, so a double click cannot send twice.
  const claimed = await q<Row>(
    `UPDATE drafts SET review_status='sending',
        subject = COALESCE($2, subject), body = COALESCE($3, body)
     WHERE id=$1 AND review_status IN ('pending','edited') RETURNING id, company_id, subject, body, review_status`,
    [draftId, subject ?? null, body ?? null],
  );
  const d = claimed[0];
  if (!d) return Response.json({ error: "draft already sent, rejected or missing" }, { status: 409 });

  const company = (await q<{ domain: string; name: string | null; status: string; contact: { chosen?: { first_name: string; last_name: string | null; email: string; position: string | null } } | null }>(
    "SELECT domain, name, status, contact FROM companies WHERE id=$1", [d.company_id]))[0];
  const person = company?.contact?.chosen;
  if (!company || !person || !company.status.startsWith("qualified")) {
    await q("UPDATE drafts SET review_status='pending' WHERE id=$1", [d.id]);
    return Response.json({ error: "company not eligible to send" }, { status: 409 });
  }

  try {
    const messageId = await sendToOwner({
      subject: d.subject,
      body: d.body,
      wouldBeRecipient: { name: `${person.first_name} ${person.last_name ?? ""}`.trim(), email: person.email, title: person.position, company: company.name ?? company.domain },
    });
    await q("UPDATE drafts SET review_status='sent', sent_at=now() WHERE id=$1", [d.id]);
    await logStep(d.company_id, "send", { to: "owner_inbox", messageId });
    return Response.json({ ok: true, messageId });
  } catch (e) {
    await q("UPDATE drafts SET review_status='pending' WHERE id=$1", [d.id]); // release so it can be retried
    await logStep(d.company_id, "send_failed", { error: (e as Error).message });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
