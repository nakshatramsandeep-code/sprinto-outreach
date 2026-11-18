import { route, bad, idOf, readJson } from "@/lib/api";
import { q } from "@/lib/db";
import { audit } from "@/lib/settings";
import type { Expected } from "@/lib/evals";

export const dynamic = "force-dynamic";

const SAAS = ["yes", "no", "unclear"];

// A human sets the correct answers. Saving marks the case as owner-confirmed.
export const PATCH = route(async (req, ctx) => {
  const id = await idOf(ctx);
  const b = await readJson<{ expected?: Expected; confirm?: boolean }>(req);
  if (!Number.isInteger(id)) return bad("bad id");
  const e = b.expected ?? {};
  const clean: Expected = {};
  if (typeof e.certified === "boolean") clean.certified = e.certified;
  if (e.saas && SAAS.includes(e.saas)) clean.saas = e.saas;
  if (typeof e.stage === "string" && e.stage.trim()) clean.stage = e.stage.trim().slice(0, 40);
  if (b.confirm && !b.expected) {
    const r = await q("UPDATE eval_cases SET labeled_by='owner', updated_at=now() WHERE id=$1 RETURNING id", [id]);
    if (!r.length) return bad("not found", 404);
    await audit("owner", "confirm eval label", { case: id });
    return { ok: true };
  }
  const r = await q("UPDATE eval_cases SET expected=$2, labeled_by='owner', updated_at=now() WHERE id=$1 RETURNING id", [id, JSON.stringify(clean)]);
  if (!r.length) return bad("not found", 404);
  await audit("owner", "label eval case", { case: id, expected: clean });
  return { ok: true };
});

export const DELETE = route(async (_req, ctx) => {
  const id = await idOf(ctx);
  await q("DELETE FROM eval_cases WHERE id=$1", [id]);
  await audit("owner", "delete eval case", { case: id });
  return { ok: true };
});
