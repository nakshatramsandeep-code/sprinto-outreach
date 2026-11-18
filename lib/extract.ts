import { createHash } from "node:crypto";
import { gemini, parseJson, Meter } from "./gemini";
import { MODELS } from "./config";
import type { RawExtraction } from "./fields";

export const EXTRACT_SYSTEM = `You extract facts about a company from website text. Rules:
- Use ONLY the text provided. Never guess. If a fact is not stated, return null.
- For every non-null value, "quote" must be an exact short snippet (max 200 chars) copied from the text.
- Return JSON only.`;

export function buildExtractPrompt(text: string, url: string, frameworks: string[]): string {
  return `Page URL: ${url}

TEXT:
"""
${text}
"""

Return JSON with exactly these keys:
{
  "company_name":      { "value": string|null, "quote": string|null },
  "is_b2b_saas":       { "value": boolean|null, "quote": string|null },   // true only if it sells software to businesses; false if consumer/agency/services/other; null if unclear
  "buyer":             { "value": string|null, "quote": string|null },   // who buys it (e.g. "finance teams", "HR leaders")
  "certifications":    [ { "name": string, "quote": string } ],          // ONLY certifications the company HOLDS or is audited for, from this list: ${frameworks.join(", ")}. Not mentions of selling compliance.
  "funding_stage":     { "value": string|null, "quote": string|null },   // e.g. "Series B"; only if stated
  "open_roles":        { "value": number|null, "quote": string|null },   // count of open job listings visible, only on a careers/jobs page
  "enterprise_signal": { "value": boolean|null, "quote": string|null }   // true if an enterprise tier, "contact sales" plan, or named large-enterprise customers appear
}`;
}

// A short fingerprint of the extraction prompt: any wording change shows up as a new hash in the eval history.
export function extractFingerprint(frameworks: string[] = ["SOC 2", "ISO 27001", "GDPR"]): string {
  return createHash("sha1").update(EXTRACT_SYSTEM + buildExtractPrompt("TEXT", "https://x/", frameworks)).digest("hex").slice(0, 8);
}

export async function extractFromText(text: string, url: string, meter: Meter, frameworks: string[] = ["SOC 2", "ISO 27001", "GDPR"]): Promise<RawExtraction> {
  const prompt = buildExtractPrompt(text, url, frameworks);
  const { text: out } = await gemini({ model: MODELS.fast(), system: EXTRACT_SYSTEM, prompt, json: true, meter });
  return parseJson<RawExtraction>(out);
}
