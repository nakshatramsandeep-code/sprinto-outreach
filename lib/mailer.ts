import { Resend } from "resend";

// GUARDRAIL: the recipient is ALWAYS OWNER_EMAIL. There is no code path that takes a recipient from data.
export async function sendToOwner(args: {
  subject: string;
  body: string;
  wouldBeRecipient: { name: string; email: string; title: string | null; company: string };
}) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OWNER_EMAIL;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  if (!to) throw new Error("OWNER_EMAIL is not set");

  const r = args.wouldBeRecipient;
  const header =
    `[DRAFT - not sent to the prospect]\n` +
    `Would-be recipient: ${r.name} <${r.email}>${r.title ? `, ${r.title}` : ""} at ${r.company}\n` +
    `----------------------------------------\n\n`;

  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: [to],
    subject: `[Sprinto draft] ${args.subject}`,
    text: header + args.body,
  });
  if (error) throw new Error(`resend: ${error.message}`);
  return data?.id ?? null;
}
