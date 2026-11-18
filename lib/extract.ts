import { gemini, parseJson, Meter } from "./gemini";
import { MODELS } from "./config";
import type { RawExtraction } from "./fields";

const SYSTEM = `You extract facts about a company from website text. Rules:
- Use ONLY the text provided. Never guess. If a fact is not stated, return null.
- For every non-null value, "quote" must be an exact short snippet (max 200 chars) copied from the text.
- Return JSON only.`;

export async function extractFromText(text: string, url: string, meter: Meter): Promise<RawExtraction> {
  const prompt = `Page URL: ${url}

TEXT:
"""
${text}
"""

Return JSON with exactly these keys:
{
  "company_name":      { "value": string|null, "quote": string|null },
  "is_b2b_saas":       { "value": boolean|null, "quote": string|null },   // true only if it sells software to businesses; false if consumer/agency/services/other; null if unclear
  "buyer":             { "value": string|null, "quote": string|null },   // who buys it (e.g. "finance teams", "HR leaders")
  "certifications":    [ { "name": string, "quote": string } ],          // ONLY certifications the company HOLDS or is audited for: SOC 2, ISO 27001, GDPR compliance. Not mentions of selling compliance.
  "funding_stage":     { "value": string|null, "quote": string|null },   // e.g. "Series B"; only if stated
  "open_roles":        { "value": number|null, "quote": string|null },   // count of open job listings visible, only on a careers/jobs page
  "enterprise_signal": { "value": boolean|null, "quote": string|null }   // true if an enterprise tier, "contact sales" plan, or named large-enterprise customers appear
}`;
  const { text: out } = await gemini({ model: MODELS.fast(), system: SYSTEM, prompt, json: true, meter });
  return parseJson<RawExtraction>(out);
}
