// One-off: accounts researched BEFORE the Review queue existed and flagged "no suitable contact" have no checkpoint,
// so they never show up for a human. This opens the missing contact checkpoint for each. Safe to re-run (idempotent).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
for (const l of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const sql = neon(process.env.DATABASE_URL);
const rows = await sql.query(`
  SELECT c.id, c.domain, c.contact FROM companies c
  WHERE c.status LIKE 'qualified%' AND 'no_suitable_contact' = ANY(c.flags)
    AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.company_id=c.id)
    AND NOT EXISTS (SELECT 1 FROM checkpoints k WHERE k.company_id=c.id AND k.kind='contact' AND k.status='open')`);
for (const r of rows) {
  const top = r.contact?.top ?? [], best = r.contact?.best ?? null;
  const reason = best ? `no Head/VP-level contact found; best match is "${best.position}"` : "no matching person found: email needed";
  await sql.query("INSERT INTO checkpoints (company_id, kind, reason, data) VALUES ($1,'contact',$2,$3)", [r.id, reason, JSON.stringify({ top, best, total: r.contact?.total ?? 0 })]);
  console.log("opened contact checkpoint for", r.domain);
}
console.log(rows.length ? `backfilled ${rows.length} account(s)` : "nothing to backfill");
