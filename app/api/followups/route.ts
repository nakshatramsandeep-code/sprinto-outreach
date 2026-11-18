import { route, bad, readJson } from "@/lib/api";
import { createFollowUp, dueFollowUps } from "@/lib/followup";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Draft one follow-up, or all that are due ({all:true}).
export const POST = route(async (req) => {
  const b = await readJson<{ companyId?: number; day?: number; all?: boolean }>(req);
  if (b.all) {
    const due = await dueFollowUps();
    for (const d of due) await createFollowUp(d.company_id, d.day);
    return { ok: true, drafted: due.length };
  }
  if (!Number.isInteger(b.companyId) || !Number.isInteger(b.day)) return bad("companyId and day required");
  await createFollowUp(b.companyId as number, b.day as number);
  return { ok: true, drafted: 1 };
});
