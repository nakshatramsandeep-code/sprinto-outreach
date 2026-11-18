import { CONFIG, type Status } from "./config";
import { q, logStep } from "./db";
import { getPage, FetchError, type Page } from "./fetcher";
import { pickCandidateUrls } from "./clean";
import { extractFromText } from "./extract";
import { emptyFields, mergeExtraction, type Fields } from "./fields";
import { decide, newLoopState, type Topic } from "./loop";
import { Meter, BudgetError } from "./gemini";
import { hunterDomainSearch, HunterQuotaError } from "./hunter";
import { pickContact, type Ranked } from "./rank";
import { draftWithValidation, evidenceMap } from "./email";

type CompanyRow = { id: number; domain: string; name: string | null; status: string; discovery: { quote?: string; source?: string } | null };

async function finish(id: number, status: Status, reason: string | null, extra: { rank?: number; flags?: string[]; fields?: Fields; contact?: unknown; fetches?: number; tokens?: number }) {
  await q(
    `UPDATE companies SET status=$2, reason=$3, rank=$4, flags=$5, fields=COALESCE($6, fields), contact=COALESCE($7, contact),
       loop_fetches=COALESCE($8, loop_fetches), tokens=COALESCE($9, tokens), researched_at=now(), updated_at=now() WHERE id=$1`,
    [id, status, reason, extra.rank ?? null, extra.flags ?? [], extra.fields ? JSON.stringify(extra.fields) : null, extra.contact ? JSON.stringify(extra.contact) : null, extra.fetches ?? null, extra.tokens ?? null],
  );
}

const TOPIC_KEEP_SHORT: Record<Topic, boolean> = { saas: false, cert: false, stage: true };

export async function runCompany(id: number): Promise<{ status: Status; reason: string | null }> {
  const rows = await q<CompanyRow>("SELECT id, domain, name, status, discovery FROM companies WHERE id=$1", [id]);
  const company = rows[0];
  if (!company) throw new Error("company not found");
  if (company.status === "running") return { status: "running", reason: "already running" };

  await q("UPDATE companies SET status='running', updated_at=now() WHERE id=$1", [id]);
  const meter = new Meter();
  let fields = emptyFields();
  const state = newLoopState(fields);
  const homeUrl = `https://${company.domain}/`;

  try {
    // ---- 1. homepage ----
    let home: Page;
    try {
      home = await getPage(homeUrl);
    } catch (e) {
      const reason = e instanceof FetchError ? e.reason : "network_error";
      await logStep(id, "scrape_failed", { url: homeUrl, reason });
      await finish(id, "failed", reason, {});
      return { status: "failed", reason };
    }
    await logStep(id, "scrape", { url: homeUrl, method: home.method, words: home.wordCount });

    // ---- 2. extract ----
    const first = await extractFromText(home.text, homeUrl, meter);
    fields = mergeExtraction(fields, first, home.text, homeUrl);
    state.fields = fields;
    await logStep(id, "extract", { url: homeUrl, fields }, meter.used);

    // ---- 3. the loop: code decides whether we know enough ----
    const fetched = new Set<string>([homeUrl]);
    let decision = decide(state);
    let guard = 0;
    while (decision.action === "fetch" && guard++ < 12) {
      const topic = decision.topic;
      const candidates = pickCandidateUrls(homeUrl, home.links, topic).filter((u) => !fetched.has(u));
      if (candidates.length === 0) {
        state.tried[topic] = 99; // nothing left to try for this topic, move on without spending a fetch
        await logStep(id, "loop_skip", { topic, why: "no candidate page" });
        decision = decide(state);
        continue;
      }
      const url = candidates[0];
      fetched.add(url);
      state.tried[topic]++;
      state.fetchesUsed++;
      try {
        const page = await getPage(url, { keepShort: TOPIC_KEEP_SHORT[topic] });
        if (topic === "cert") state.securityPageRead = true;
        const raw = await extractFromText(page.text, url, meter);
        fields = mergeExtraction(fields, raw, page.text, url);
        state.fields = fields;
        await logStep(id, "loop_fetch", { topic, why: decision.why, url, words: page.wordCount, fetchesUsed: state.fetchesUsed }, meter.used);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        const reason = e instanceof FetchError ? e.reason : "error";
        await logStep(id, "loop_fetch_failed", { topic, url, reason, fetchesUsed: state.fetchesUsed });
      }
      decision = decide(state);
    }
    if (decision.action === "fetch") decision = { action: "manual_review", reason: "loop_guard_stop" };

    const base = { fields, fetches: state.fetchesUsed, tokens: meter.used };
    const name = fields.company_name.value ?? company.name ?? company.domain;
    if (name && name !== company.name) await q("UPDATE companies SET name=$2 WHERE id=$1", [id, name]);

    if (decision.action === "disqualify") {
      await logStep(id, "decision", { outcome: "disqualified", reason: decision.reason });
      await finish(id, "disqualified", decision.reason, base);
      return { status: "disqualified", reason: decision.reason };
    }
    if (decision.action === "manual_review") {
      await logStep(id, "decision", { outcome: "manual_review", reason: decision.reason });
      await finish(id, "manual_review", decision.reason, base);
      return { status: "manual_review", reason: decision.reason };
    }
    // (decision.action === "qualify" from here)
    if (decision.action !== "qualify") throw new Error("unexpected decision");
    const flags = [...decision.flags];
    await logStep(id, "decision", { outcome: "qualified", rank: decision.rank, flags });

    // ---- 4. contact (only for qualified companies, to protect Hunter's 25 free searches) ----
    let chosen: Ranked | null = null;
    let contactInfo: unknown = null;
    try {
      const people = await hunterDomainSearch(company.domain);
      const small = !/series\s*(c|d|e)/i.test(fields.funding_stage.value ?? "");
      const picked = pickContact(people, small);
      chosen = picked.chosen;
      contactInfo = { provider: "hunter", total: people.length, chosen: picked.chosen, top: picked.ranked };
      await logStep(id, "contact", { provider: "hunter", found: people.length, chosen: picked.chosen, top: picked.ranked });
      if (!chosen) flags.push("no_suitable_contact");
    } catch (e) {
      if (e instanceof HunterQuotaError) flags.push("hunter_quota_exhausted"); // Apollo comes in later
      else flags.push("contact_lookup_failed");
      await logStep(id, "contact_failed", { error: (e as Error).message });
    }

    // ---- 5. pains + email (needs a real named person) ----
    let draftNote: string | null = null;
    if (chosen) {
      const evidence = evidenceMap(fields, company.discovery?.quote ?? null);
      const { draft, validation } = await draftWithValidation({ company: name, domain: company.domain, person: chosen, evidence, meter });
      await q(
        `INSERT INTO drafts (company_id, pains, hook_field, subject, body, validation, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,'pending')
         ON CONFLICT (company_id) DO UPDATE SET pains=$2, hook_field=$3, subject=$4, body=$5, validation=$6, review_status='pending', sent_at=NULL`,
        [id, JSON.stringify(draft.pains ?? []), draft.hook_field ?? null, draft.subject ?? "", draft.body ?? "", JSON.stringify(validation)],
      );
      await logStep(id, "draft", { hook_field: draft.hook_field, pains: draft.pains, validation }, meter.used);
      if (!validation.ok) { flags.push("draft_failed_validation"); draftNote = validation.problems.join("; "); }
    }

    const status: Status = flags.length ? "qualified_flagged" : "qualified";
    await finish(id, status, draftNote, { ...base, tokens: meter.used, rank: decision.rank, flags, contact: contactInfo });
    return { status, reason: flags.join(", ") || null };
  } catch (e) {
    if (e instanceof BudgetError) {
      await logStep(id, "budget_stop", { tokens: e.used });
      await finish(id, "manual_review", "token_budget_exceeded", { tokens: e.used });
      return { status: "manual_review", reason: "token_budget_exceeded" };
    }
    const msg = ((e as Error).message ?? "error").slice(0, 200);
    await logStep(id, "error", { message: msg });
    await finish(id, "failed", msg, { tokens: meter.used });
    return { status: "failed", reason: msg };
  }
}
