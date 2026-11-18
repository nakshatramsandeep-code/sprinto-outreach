import { route, bad, readJson } from "@/lib/api";
import { applySuggestion, dismissSuggestion } from "@/lib/learning";

export const dynamic = "force-dynamic";

// Applying saves a NEW ICP version (reversible from the ICP & Rules page). Dismissing hides a suggestion.
export const POST = route(async (req) => {
  const { id, dismiss } = await readJson<{ id?: string; dismiss?: boolean }>(req);
  if (!id) return bad("id required");
  if (dismiss) { await dismissSuggestion(id); return { ok: true }; }
  const r = await applySuggestion(id);
  return "error" in r ? bad(r.error, 409) : { ok: true, version: r.version };
});
