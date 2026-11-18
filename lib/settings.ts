import { q } from "./db";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await q<{ value: T }>("SELECT value FROM settings WHERE key=$1", [key]);
  return r[0] ? r[0].value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await q("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2", [key, JSON.stringify(value)]);
}

export async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await q("INSERT INTO audit_log (actor, action, detail) VALUES ($1,$2,$3)", [actor, action, JSON.stringify(detail)]);
}

// ---- Sprinto sender profile: proof points must be copied from sprinto.com with their source page, never invented ----
export type SenderProfile = {
  senderName: string;
  signoff: string;
  oneLiner: string;
  proofPoints: { text: string; source: string }[];
};
export const DEFAULT_PROFILE: SenderProfile = {
  senderName: "Growth Team",
  signoff: "Sprinto",
  oneLiner: "Sprinto automates compliance (SOC 2, ISO 27001, GDPR) for SaaS companies.",
  proofPoints: [],
};
export const getProfile = () => getSetting<SenderProfile>("sender_profile", DEFAULT_PROFILE);

export const getAutoQueue = () => getSetting<boolean>("auto_queue", true);

// ---- Human checkpoints (the Review queue) ----
export type CheckpointKind = "qualification" | "contact" | "angle" | "send" | "system";
export const KIND_CODE: Record<CheckpointKind, string> = { qualification: "H2", contact: "H3", angle: "H4", send: "H5", system: "H7" };

export async function openCheckpoint(companyId: number | null, kind: CheckpointKind, reason: string, data: Record<string, unknown> = {}) {
  // one open checkpoint of a kind per company
  const existing = companyId === null ? [] : await q("SELECT id FROM checkpoints WHERE company_id=$1 AND kind=$2 AND status='open'", [companyId, kind]);
  if (existing.length) {
    await q("UPDATE checkpoints SET reason=$2, data=$3 WHERE id=$1", [(existing[0] as { id: number }).id, reason, JSON.stringify(data)]);
    return;
  }
  await q("INSERT INTO checkpoints (company_id, kind, reason, data) VALUES ($1,$2,$3,$4)", [companyId, kind, reason, JSON.stringify(data)]);
}

export async function closeCheckpoints(companyId: number, kinds: CheckpointKind[], status = "resolved", resolution: Record<string, unknown> = {}) {
  await q("UPDATE checkpoints SET status=$3, resolution=$4, resolved_at=now() WHERE company_id=$1 AND kind = ANY($2) AND status='open'", [companyId, kinds, status, JSON.stringify(resolution)]);
}

// Checkpoints nobody answered in 7 days are skipped automatically (and logged).
export async function expireCheckpoints() {
  const r = await q<{ id: number; kind: string }>(
    "UPDATE checkpoints SET status='expired', resolved_at=now(), resolution='{\"auto\":\"no answer within 7 days\"}' WHERE status='open' AND created_at < now() - interval '7 days' RETURNING id, kind",
  );
  for (const x of r) await audit("system", "review expired", { checkpoint: x.id, kind: x.kind, note: "No answer within 7 days: auto-skipped" });
}
