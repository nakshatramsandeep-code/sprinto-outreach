import { CONFIG, MODELS } from "./config";
import { gemini, parseJson, Meter } from "./gemini";
import type { Fields } from "./fields";
import type { Ranked } from "./rank";
import { DEFAULT_PROFILE, type SenderProfile } from "./settings";

export type Draft = {
  pains: { pain: string; evidence_field: string }[];
  hook_field: string;
  subject: string;
  body: string;
};

export type Validation = { ok: boolean; problems: string[] };

const EVIDENCE_KEYS = ["company_name", "is_b2b_saas", "buyer", "funding_stage", "open_roles", "enterprise_signal", "compliance_hiring", "discovery_signal", "certifications"] as const;

// Quote text available as evidence for the writer (only verified quotes).
export function evidenceMap(fields: Fields, discoverySignal?: string | null): Record<string, string> {
  const m: Record<string, string> = {};
  for (const k of ["company_name", "is_b2b_saas", "buyer", "funding_stage", "open_roles", "enterprise_signal", "compliance_hiring"] as const) {
    const e = fields[k];
    if (e.value !== null && e.quote) m[k] = `${String(e.value)} - "${e.quote}"`;
  }
  if (fields.certifications.length) m.certifications = fields.certifications.map((c) => c.name).join(", ");
  if (discoverySignal) m.discovery_signal = discoverySignal;
  return m;
}

// GUARDRAIL: the draft must be defensible. Checked in code, not by asking the model.
export function validateDraft(
  d: Draft,
  firstName: string,
  evidence: Record<string, string>,
  rules: { minWords: number; maxWords: number; bannedPhrases: readonly string[] } = CONFIG.email,
): Validation {
  const problems: string[] = [];
  const body = d.body ?? "";
  const words = (body.match(/\S+/g) ?? []).length;
  if (!d.subject || d.subject.length < 4 || d.subject.length > 90) problems.push("subject length");
  if (!new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body)) problems.push("recipient first name missing");
  if (/\[[^\]]*\]|\{\{|\}\}|<[^>]+>/.test(body + d.subject)) problems.push("placeholder or markup left in text");
  if (words < rules.minWords || words > rules.maxWords) problems.push(`body is ${words} words (want ${rules.minWords}-${rules.maxWords})`);
  if (!/sprinto/i.test(body)) problems.push("does not mention Sprinto");
  const lower = (body + " " + d.subject).toLowerCase();
  for (const p of rules.bannedPhrases) if (lower.includes(p.toLowerCase())) problems.push(`banned phrase: ${p}`);
  if ((body.match(/\?/g) ?? []).length > 2) problems.push("more than one ask");

  if (!d.hook_field || !(EVIDENCE_KEYS as readonly string[]).includes(d.hook_field) || !evidence[d.hook_field]) {
    problems.push("hook is not tied to a collected evidence field");
  } else {
    // body must reuse at least one distinctive word from the evidence it claims to rely on
    const words = (evidence[d.hook_field].toLowerCase().match(/[a-z0-9]{6,}/g) ?? []).filter((w) => !["series"].includes(w));
    if (words.length && !words.some((w) => lower.includes(w))) problems.push("hook text does not reflect the evidence");
  }
  if (!Array.isArray(d.pains) || d.pains.length !== 2) problems.push("need exactly two pain points");
  else for (const p of d.pains) if (!p.pain || !evidence[p.evidence_field]) problems.push("a pain point has no evidence behind it");
  return { ok: problems.length === 0, problems };
}

const buildSystem = (profile: SenderProfile) => `You write one cold email for Sprinto. ${profile.oneLiner}
Rules: use ONLY the evidence given${profile.proofPoints.length ? " and the approved proof points" : ""}; never invent facts, customers or numbers; no flattery clichés; plain, specific, human.`;

export async function draftEmail(args: {
  company: string;
  domain: string;
  person: Ranked;
  evidence: Record<string, string>;
  meter: Meter;
  feedback?: string[];
  profile?: SenderProfile;
  rules?: { minWords: number; maxWords: number; bannedPhrases: readonly string[] };
}): Promise<Draft> {
  const { person, evidence } = args;
  const profile = args.profile ?? DEFAULT_PROFILE;
  const rules = args.rules ?? CONFIG.email;
  const prompt = `Recipient: ${person.first_name} ${person.last_name ?? ""}, ${person.position} at ${args.company} (${args.domain}).

EVIDENCE (the only facts you may use). Keys are the allowed evidence_field values:
${Object.entries(evidence).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Task:
1. Pick the TWO most likely pain points THIS person's role has, each grounded in one evidence key.
2. Write the email: address ${person.first_name} by first name; open with one specific hook from one evidence key; connect it to one pain; one low-friction ask (a short call or a reply); ${rules.minWords}-${rules.maxWords} words; mention Sprinto once; sign off as "${profile.senderName}, ${profile.signoff}". No placeholders.${profile.proofPoints.length ? `\nApproved proof points (you may use at most one, verbatim, never alter numbers): ${profile.proofPoints.map((p) => p.text).join(" | ")}` : ""}
${args.feedback?.length ? `\nYour previous attempt failed these checks, fix them: ${args.feedback.join("; ")}\n` : ""}
Return JSON: { "pains": [ {"pain": string, "evidence_field": string}, {"pain": string, "evidence_field": string} ], "hook_field": string, "subject": string, "body": string }`;
  const { text } = await gemini({ model: MODELS.pro(), system: buildSystem(profile), prompt, json: true, meter: args.meter, temperature: 0.5 });
  return parseJson<Draft>(text);
}

// Short follow-up bump for day 3 / 7 / 14. Grounded in the first email, no new claims.
export async function draftFollowUp(args: { firstName: string; company: string; originalSubject: string; originalBody: string; day: number; profile: SenderProfile; meter: Meter }) {
  const prompt = `Write a short follow-up email (day ${args.day} after the first email). Address ${args.firstName} by first name. 35-70 words. Do not repeat the first email; add one small, low-pressure nudge or a different angle taken ONLY from the first email's content. No new facts or numbers. Sign off as "${args.profile.senderName}, ${args.profile.signoff}".

FIRST EMAIL:
Subject: ${args.originalSubject}
${args.originalBody}

Return JSON: { "subject": string, "body": string }`;
  const { text } = await gemini({ model: MODELS.pro(), system: buildSystem(args.profile), prompt, json: true, meter: args.meter, temperature: 0.5 });
  return parseJson<{ subject: string; body: string }>(text);
}

// One generation, then one retry that tells the model what failed. Never loops further.
export async function draftWithValidation(args: Omit<Parameters<typeof draftEmail>[0], "feedback">) {
  let d = await draftEmail(args);
  let v = validateDraft(d, args.person.first_name ?? "", args.evidence, args.rules);
  if (!v.ok) {
    d = await draftEmail({ ...args, feedback: v.problems });
    v = validateDraft(d, args.person.first_name ?? "", args.evidence, args.rules);
  }
  return { draft: d, validation: v };
}
