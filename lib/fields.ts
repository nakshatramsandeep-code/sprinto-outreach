import { quoteInText } from "./clean";

// The named fields the loop reasons over. Code (not the model) checks which are filled.
export type Evidence<T> = { value: T | null; quote: string | null; url: string | null };

export type Fields = {
  company_name: Evidence<string>;
  is_b2b_saas: Evidence<boolean>;
  buyer: Evidence<string>;
  certifications: { name: string; quote: string; url: string }[];
  funding_stage: Evidence<string>;
  open_roles: Evidence<number>;
  enterprise_signal: Evidence<boolean>;
  // Structured (from a public job-board API, not the model): titles of open compliance/security roles.
  compliance_hiring: Evidence<string>;
};

export const emptyEvidence = <T,>(): Evidence<T> => ({ value: null, quote: null, url: null });

export const emptyFields = (): Fields => ({
  company_name: emptyEvidence(),
  is_b2b_saas: emptyEvidence(),
  buyer: emptyEvidence(),
  certifications: [],
  funding_stage: emptyEvidence(),
  open_roles: emptyEvidence(),
  enterprise_signal: emptyEvidence(),
  compliance_hiring: emptyEvidence(),
});

// Raw shape the model returns for one page.
export type RawExtraction = {
  company_name?: { value?: string | null; quote?: string | null };
  is_b2b_saas?: { value?: boolean | null; quote?: string | null };
  buyer?: { value?: string | null; quote?: string | null };
  certifications?: { name?: string; quote?: string }[];
  funding_stage?: { value?: string | null; quote?: string | null };
  open_roles?: { value?: number | null; quote?: string | null };
  enterprise_signal?: { value?: boolean | null; quote?: string | null };
};

/**
 * Merge one page's extraction into the running fields.
 * GUARDRAIL: a value is only accepted if its quote really appears in the page text.
 * Existing non-null values are kept (earlier pages win), nulls get filled.
 */
export function mergeExtraction(current: Fields, raw: RawExtraction, pageText: string, url: string): Fields {
  const next: Fields = JSON.parse(JSON.stringify(current));

  const fill = <K extends "company_name" | "is_b2b_saas" | "buyer" | "funding_stage" | "open_roles" | "enterprise_signal">(key: K) => {
    const r = raw[key] as { value?: unknown; quote?: string | null } | undefined;
    if (!r || r.value === null || r.value === undefined) return;
    if (next[key].value !== null) return;
    if (!quoteInText(r.quote, pageText)) return; // unverifiable -> rejected
    (next[key] as Evidence<unknown>) = { value: r.value, quote: (r.quote as string).slice(0, 240), url };
  };
  (["company_name", "is_b2b_saas", "buyer", "funding_stage", "open_roles", "enterprise_signal"] as const).forEach(fill);

  for (const c of raw.certifications ?? []) {
    if (!c?.name || !quoteInText(c.quote, pageText)) continue;
    if (next.certifications.some((x) => x.name.toLowerCase() === c.name!.toLowerCase())) continue;
    next.certifications.push({ name: c.name, quote: (c.quote as string).slice(0, 240), url });
  }
  return next;
}
