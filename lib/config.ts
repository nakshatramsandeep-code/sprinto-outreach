// One place for the ICP, the caps and every guardrail threshold.
// Change numbers here, not in the pipeline code.

export const CONFIG = {
  icp: {
    description:
      "B2B SaaS, roughly Series A-C (about 30-500 staff), NOT already certified in SOC 2 / ISO 27001 / GDPR, showing compliance pressure.",
    // Stage is "right" when ANY one of these holds.
    minOpenRolesForStage: 5,
    competitors: ["vanta.com", "drata.com", "secureframe.com", "thoropass.com", "scrut.io", "sprinto.com"],
    bigCompanyBlocklist: ["google.com", "microsoft.com", "amazon.com", "salesforce.com", "oracle.com", "ibm.com", "sap.com", "adobe.com", "meta.com", "apple.com"],
  },

  discovery: {
    maxCandidatesPerRun: 10, // matches 8-15 companies a week
    maxGroundedQueries: 3,
    maxHnComments: 40,
  },

  loop: {
    maxExtraFetches: 4, // hard cap beyond the homepage
    certTries: 1,
    stageTries: 2,
    saasTries: 1,
  },

  scrape: {
    timeoutMs: 10_000,
    maxBytes: 1_500_000,
    minHostGapMs: 1_000, // polite delay between requests to one host
    thinWordCount: 200, // below this, try the JS-rendering fallback
    minUsefulWords: 40, // below this after fallback = thin_content failure
    cacheDays: 7,
    maxCleanTokens: 2_000,
    userAgent: "SprintoOutreachResearchBot/1.0 (single-page research, respects robots.txt)",
  },

  budget: {
    maxTokensPerCompany: 60_000, // hard ceiling on LLM tokens for one company
    hunterMonthlyLimit: 25,
    hunterResultLimit: 10,
  },

  email: {
    minWords: 60,
    maxWords: 140,
    bannedPhrases: ["hope this email finds you well", "revolutionary", "game-changing", "game changing", "cutting-edge", "synergy"],
  },
} as const;

export type Status =
  | "queued"
  | "running"
  | "qualified"
  | "qualified_flagged"
  | "disqualified"
  | "manual_review"
  | "failed";

export const MODELS = {
  fast: () => process.env.GEMINI_FAST_MODEL || "gemini-3.8-flash",
  pro: () => process.env.GEMINI_PRO_MODEL || "gemini-4-carbon",
};
