import { GoogleGenAI } from "@google/genai";
import { CONFIG } from "./config";

export class BudgetError extends Error {
  constructor(public used: number) {
    super(`token budget exceeded (${used})`);
  }
}

// Tracks tokens for ONE company so a runaway loop cannot spend without limit.
export class Meter {
  used = 0;
  constructor(public max: number = CONFIG.budget.maxTokensPerCompany) {}
  add(n: number) {
    this.used += n;
    if (this.used > this.max) throw new BudgetError(this.used);
  }
}

let client: GoogleGenAI | null = null;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CallOpts = {
  model: string;
  prompt: string;
  system?: string;
  json?: boolean; // ask for JSON output
  search?: boolean; // Google Search grounding (cannot be combined with json mode)
  meter?: Meter;
  temperature?: number;
};

// One wrapper for every Gemini call: retries on rate limits (free tier), counts tokens.
export async function gemini(opts: CallOpts): Promise<{ text: string; tokens: number }> {
  let lastErr: unknown;
  // Extraction and drafting do not need long hidden "thinking": switching it off is ~3x faster and uses far fewer tokens.
  // If a model rejects the setting we retry without it.
  let thinkingOff = !opts.search;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: opts.model,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.2,
          httpOptions: { timeout: opts.search ? 110_000 : 45_000 }, // a hung call must not hang the run
          ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
          ...(opts.search ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });
      const tokens = res.usageMetadata?.totalTokenCount ?? 0;
      opts.meter?.add(tokens);
      return { text: res.text ?? "", tokens };
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      if (thinkingOff && /thinking/i.test(msg)) { thinkingOff = false; continue; }
      const retryable = /429|rate|quota|unavailable|503|504|overloaded|deadline|abort|timed? ?out|fetch failed/i.test(msg);
      if (!retryable) break;
      if (attempt < 3) await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s between tries
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("gemini call failed");
}

// Models sometimes wrap JSON in fences or add prose. Pull out the first JSON value.
export function parseJson<T = unknown>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[\[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("model did not return valid JSON");
  }
}
