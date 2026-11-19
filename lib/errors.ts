// Turn raw provider errors (often a JSON blob) into one short, plain sentence a person can act on.
export function friendlyError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e ?? "error");
  let msg = raw;
  try { const j = JSON.parse(raw); msg = j?.error?.message ?? j?.message ?? raw; } catch { /* not JSON */ }
  if (/api key not valid|API_KEY_INVALID|invalid api key|unauthor/i.test(msg)) return "AI service rejected our API key (check GEMINI_API_KEY)";
  if (/quota|rate.?limit|429|resource.?exhausted/i.test(msg)) return "AI service is rate-limiting us, retry shortly";
  if (/deadline|timed? ?out|abort/i.test(msg)) return "Timed out, retry";
  if (/unavailable|503|overloaded/i.test(msg)) return "AI service temporarily unavailable, retry";
  if (/no longer available|not found.*model|model.*not found/i.test(msg)) return "the configured AI model is not available for this key";
  if (/network_error|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) return "Could not reach the site, retry";
  return msg.replace(/\s+/g, " ").slice(0, 160);
}
