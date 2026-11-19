import { route, bad, readJson } from "@/lib/api";
import { qm } from "@/lib/db";
import { NEWS_FEEDS } from "@/lib/discover";
import { setSetting, audit, DEFAULT_PROFILE, type SenderProfile } from "@/lib/settings";

export const dynamic = "force-dynamic";

const has = (k: string) => !!process.env[k];

export const GET = route(async () => {
  const [log, settings] = await qm([
    // Eval/simulation housekeeping is developer tooling, not a decision about a prospect, so it stays out of this log.
    ["SELECT id, actor, action, detail, created_at FROM audit_log WHERE action !~* '(eval|simulation)' ORDER BY id DESC LIMIT 12"],
    ["SELECT key, value FROM settings WHERE key IN ('auto_queue','sender_profile')"],
  ]);
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  return {
    integrations: [
      { name: "Neon Postgres", ok: has("DATABASE_URL") },
      { name: "Gemini", ok: has("GEMINI_API_KEY") },
      { name: "Hunter.io", ok: has("HUNTER_API_KEY") },
      { name: "Resend", ok: has("RESEND_API_KEY") },
      { name: "Resend webhook", ok: has("RESEND_WEBHOOK_SECRET"), optional: true },
      { name: "Apollo", ok: false, optional: true, note: "planned: used once Hunter's monthly searches run out" },
    ],
    demo: { on: true, inbox: process.env.OWNER_EMAIL ? process.env.OWNER_EMAIL.replace(/^(.).*(@.*)$/, "$1•••$2") : null },
    autoQueue: get("auto_queue") ?? true,
    sources: ["Hacker News: Who is hiring (SOC 2 / compliance)", "Google Search through Gemini (3 signal queries)", ...NEWS_FEEDS.map((f) => f.label)],
    profile: (get("sender_profile") as SenderProfile | undefined) ?? DEFAULT_PROFILE,
    log,
  };
});

export const POST = route(async (req) => {
  const b = await readJson<{ autoQueue?: boolean; profile?: SenderProfile }>(req);
  if (typeof b.autoQueue !== "boolean" && !b.profile) return bad("nothing to save: send autoQueue or profile");
  if (typeof b.autoQueue === "boolean") {
    await setSetting("auto_queue", b.autoQueue);
    await audit("owner", "toggle auto queue discovered", { on: b.autoQueue });
  }
  if (b.profile) {
    const p = b.profile;
    if (!p.senderName?.trim() || !p.signoff?.trim()) return bad("sender name and sign-off are required");
    const proofs = (p.proofPoints ?? []).filter((x) => x.text?.trim());
    if (proofs.some((x) => !x.source?.trim())) return bad("every proof point needs the sprinto.com page it came from");
    await setSetting("sender_profile", { senderName: p.senderName.trim(), signoff: p.signoff.trim(), oneLiner: (p.oneLiner ?? "").trim(), proofPoints: proofs });
    await audit("owner", "save sender profile", {});
  }
  return { ok: true };
});
