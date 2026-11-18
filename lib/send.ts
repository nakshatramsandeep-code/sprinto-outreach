import { q, logStep } from "./db";
import { sendToOwner } from "./mailer";
import { audit, closeCheckpoints } from "./settings";

type Row = { id: number; company_id: number; kind: string; subject: string; body: string; original_body: string | null };

// The only way an email leaves the system. Atomic claim: a double click or a retry can never send twice.
export async function sendDraft(draftId: number, edit?: { subject?: string; body?: string }, actor = "owner"): Promise<{ ok: true; messageId: string | null } | { ok: false; status: number; error: string }> {
  const claimed = await q<Row>(
    `UPDATE drafts SET review_status='sending', subject = COALESCE($2, subject), body = COALESCE($3, body)
     WHERE id=$1 AND review_status IN ('pending','edited') RETURNING id, company_id, kind, subject, body, original_body`,
    [draftId, edit?.subject ?? null, edit?.body ?? null],
  );
  const d = claimed[0];
  if (!d) return { ok: false, status: 409, error: "draft already sent, rejected or missing" };

  const company = (await q<{ domain: string; name: string | null; status: string; contact: { chosen?: { first_name: string; last_name: string | null; email: string; position: string | null } } | null }>(
    "SELECT domain, name, status, contact FROM companies WHERE id=$1", [d.company_id]))[0];
  const person = company?.contact?.chosen;
  if (!company || !person || !(company.status.startsWith("qualified") || company.status === "maybe")) {
    await q("UPDATE drafts SET review_status='pending' WHERE id=$1", [d.id]);
    return { ok: false, status: 409, error: "company not eligible to send" };
  }

  try {
    const messageId = await sendToOwner({
      subject: d.kind === "first" ? d.subject : d.subject,
      body: d.body,
      wouldBeRecipient: { name: `${person.first_name} ${person.last_name ?? ""}`.trim(), email: person.email, title: person.position, company: company.name ?? company.domain },
    });
    const edited = d.original_body !== null && d.original_body.trim() !== d.body.trim();
    await q("UPDATE drafts SET review_status='sent', sent_at=now(), message_id=$2, edited=$3 WHERE id=$1", [d.id, messageId, edited]);
    await closeCheckpoints(d.company_id, ["send", "angle"], "resolved", { sent: true });
    await logStep(d.company_id, "send", { to: "owner_inbox", messageId, kind: d.kind, edited });
    await audit(actor, "approve & send", { draft: d.id, company: d.company_id, kind: d.kind, edited });
    return { ok: true, messageId };
  } catch (e) {
    await q("UPDATE drafts SET review_status='pending' WHERE id=$1", [d.id]); // release so it can be retried
    await logStep(d.company_id, "send_failed", { error: (e as Error).message });
    return { ok: false, status: 502, error: (e as Error).message };
  }
}
