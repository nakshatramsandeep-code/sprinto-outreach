import { type Status } from "./config";
import { q, logStep } from "./db";
import { getPage, FetchError, HARD_STOP, type Page } from "./fetcher";
import { pickCandidateUrls } from "./clean";
import { loadSitemapUrls, pickFromSitemap } from "./sitemap";
import { findJobs } from "./ats";
import { extractFromText } from "./extract";
import { emptyFields, mergeExtraction, type Fields } from "./fields";
import { decide, newLoopState, type Topic } from "./loop";
import { Meter, BudgetError } from "./gemini";
import { hunterDomainSearch, HunterQuotaError } from "./hunter";
import { pickContact, type Ranked } from "./rank";
import { draftWithValidation, evidenceMap } from "./email";
import { getIcp, type IcpConfig } from "./icp";
import { scoreCompany, type DiscoveryInfo } from "./score";
import { getProfile, openCheckpoint, closeCheckpoints } from "./settings";
import { friendlyError } from "./errors";

type CompanyRow = {
  id: number; domain: string; name: string | null; status: string; source: string | null;
  discovery: (DiscoveryInfo & { url?: string | null }) | null; extra_urls: string[];
  fields: Fields | null; flags: string[]; score: number | null;
};

async function finish(
  id: number,
  status: Status,
  reason: string | null,
  extra: { score?: number; tier?: string; breakdown?: unknown; flags?: string[]; fields?: Fields; contact?: unknown; fetches?: number; tokens?: number; t0?: number; version?: number },
) {
  await q(
    `UPDATE companies SET status=$2, reason=$3, rank=COALESCE($4, rank), score=COALESCE($4, score), tier=COALESCE($5, tier),
       score_breakdown=COALESCE($6, score_breakdown), flags=$7, fields=COALESCE($8, fields), contact=COALESCE($9, contact),
       loop_fetches=COALESCE($10, loop_fetches), tokens=COALESCE($11, tokens),
       duration_ms=COALESCE($12, duration_ms), icp_version=COALESCE($13, icp_version), researched_at=now(), updated_at=now() WHERE id=$1`,
    [
      id, status, reason, extra.score ?? null, extra.tier ?? null,
      extra.breakdown ? JSON.stringify(extra.breakdown) : null, extra.flags ?? [],
      extra.fields ? JSON.stringify(extra.fields) : null, extra.contact ? JSON.stringify(extra.contact) : null,
      extra.fetches ?? null, extra.tokens ?? null, extra.t0 ? Date.now() - extra.t0 : null, extra.version ?? null,
    ],
  );
}

const FETCH_FAIL_TEXT: Record<string, string> = {
  robots_disallowed: "robots.txt disallows the homepage",
  bot_protection: "bot protection (Cloudflare-style) blocks the homepage",
  captcha: "a CAPTCHA blocks the homepage",
  blocked_or_login: "the homepage blocks us or needs a login",
  rate_limited: "the site is rate-limiting us",
  thin_content: "the homepage has almost no readable text (likely JavaScript-rendered)",
};

const TOPIC_KEEP_SHORT: Record<Topic, boolean> = { saas: false, cert: false, stage: true };

export async function runCompany(id: number, opts: { force?: boolean } = {}): Promise<{ status: Status; reason: string | null; tokens: number }> {
  const t0 = Date.now();
  const { config: cfg, version } = await getIcp();
  const rows = await q<CompanyRow>("SELECT id, domain, name, status, source, discovery, extra_urls, fields, flags, score FROM companies WHERE id=$1", [id]);
  const company = rows[0];
  if (!company) throw new Error("company not found");
  if (company.status === "running") return { status: "running", reason: "already running", tokens: 0 };

  await q("UPDATE companies SET status='running', updated_at=now() WHERE id=$1", [id]);
  await closeCheckpoints(id, ["qualification", "contact", "angle", "send"], "superseded", { by: "re-run" });
  const meter = new Meter(cfg.tokensPerCompany);
  let fields = emptyFields();
  const state = newLoopState(fields);
  const homeUrl = `https://${company.domain}/`;
  const loopOpts = { cap: cfg.loopFetchCap, minRoles: cfg.minOpenRolesForStage };

  try {
    // ---- 1. homepage ----
    let home: Page;
    try {
      home = await getPage(homeUrl);
    } catch (e) {
      const reason = e instanceof FetchError ? e.reason : "network_error";
      await logStep(id, "scrape_failed", { url: homeUrl, reason });
      if (e instanceof FetchError && (HARD_STOP.includes(e.reason) || e.reason === "thin_content")) {
        await openCheckpoint(id, "qualification", FETCH_FAIL_TEXT[e.reason] ?? reason, { fetchReason: e.reason, pages: [homeUrl] });
        await finish(id, "manual_review", reason, { t0, version });
        return { status: "manual_review", reason, tokens: meter.used };
      }
      await finish(id, "failed", reason, { t0, version });
      return { status: "failed", reason, tokens: meter.used };
    }
    await logStep(id, "scrape", { url: homeUrl, method: home.method, words: home.wordCount });

    // ---- 2. extract ----
    fields = mergeExtraction(fields, await extractFromText(home.text, homeUrl, meter, cfg.targetFrameworks), home.text, homeUrl);
    state.fields = fields;
    await logStep(id, "extract", { url: homeUrl, fields }, meter.used);

    // extra pages a human asked us to read ("Add URL & retry")
    for (const u of company.extra_urls ?? []) {
      try {
        const page = await getPage(u, { keepShort: true });
        fields = mergeExtraction(fields, await extractFromText(page.text, u, meter, cfg.targetFrameworks), page.text, u);
        state.fields = fields;
        await logStep(id, "extra_url", { url: u, words: page.wordCount }, meter.used);
      } catch (e) {
        await logStep(id, "extra_url_failed", { url: u, reason: e instanceof FetchError ? e.reason : "error" });
      }
    }

    // ---- 3. the loop: code decides whether we know enough ----
    const fetched = new Set<string>([homeUrl, ...(company.extra_urls ?? [])]);
    const allLinks = [...home.links];
    let sitemap: string[] | null = null;
    let atsTried = false;
    let decision = decide(state, loopOpts);
    let guard = 0;
    while (decision.action === "fetch" && guard++ < 12) {
      const topic = decision.topic;

      if (topic === "stage" && !atsTried) {
        atsTried = true;
        const jobs = await findJobs(company.domain, company.name ?? company.domain, allLinks).catch(() => null);
        if (jobs) {
          fields.open_roles = { value: jobs.count, quote: `${jobs.count} open roles on the ${jobs.provider} job board`, url: jobs.url };
          if (jobs.complianceTitles.length) fields.compliance_hiring = { value: jobs.complianceTitles.join("; "), quote: jobs.complianceTitles[0], url: jobs.url };
          state.fields = fields;
          state.tried.stage++;
          await logStep(id, "ats", { provider: jobs.provider, token: jobs.token, open_roles: jobs.count, compliance_titles: jobs.complianceTitles, url: jobs.url });
          decision = decide(state, loopOpts);
          continue;
        }
        await logStep(id, "ats_none", { note: "no public job board found, falling back to careers page" });
      }

      if (sitemap === null) {
        sitemap = await loadSitemapUrls(company.domain).catch(() => []);
        await logStep(id, "sitemap", { urls: sitemap.length });
      }
      const fromMap = pickFromSitemap(sitemap, homeUrl, topic);
      const candidates = [...new Set([...fromMap, ...pickCandidateUrls(homeUrl, allLinks, topic, { guess: sitemap.length < 10 })])].filter((u) => !fetched.has(u));
      if (candidates.length === 0) {
        state.tried[topic] = 99;
        await logStep(id, "loop_skip", { topic, why: "no candidate page" });
        decision = decide(state, loopOpts);
        continue;
      }
      const url = candidates[0];
      fetched.add(url);
      state.tried[topic]++;
      state.fetchesUsed++;
      try {
        const page = await getPage(url, { keepShort: TOPIC_KEEP_SHORT[topic] });
        if (topic === "cert") state.securityPageRead = true;
        allLinks.push(...page.links);
        fields = mergeExtraction(fields, await extractFromText(page.text, url, meter, cfg.targetFrameworks), page.text, url);
        state.fields = fields;
        await logStep(id, "loop_fetch", { topic, why: decision.why, url, words: page.wordCount, fetchesUsed: state.fetchesUsed }, meter.used);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        await logStep(id, "loop_fetch_failed", { topic, url, reason: e instanceof FetchError ? e.reason : "error", fetchesUsed: state.fetchesUsed });
      }
      decision = decide(state, loopOpts);
    }
    if (decision.action === "fetch") decision = { action: "manual_review", reason: "loop_guard_stop" };

    const base = { fields, fetches: state.fetchesUsed, tokens: meter.used, t0, version };
    const name = fields.company_name.value ?? company.name ?? company.domain;
    if (name && name !== company.name) await q("UPDATE companies SET name=$2 WHERE id=$1", [id, name]);

    if (decision.action === "disqualify") {
      await logStep(id, "decision", { outcome: "disqualified", reason: decision.reason });
      await finish(id, "disqualified", decision.reason, base);
      return { status: "disqualified", reason: decision.reason, tokens: meter.used };
    }
    if (decision.action === "manual_review") {
      await logStep(id, "decision", { outcome: "manual_review", reason: decision.reason });
      await openCheckpoint(id, "qualification", decision.reason === "product_type_unknown" ? "cannot tell if this is B2B SaaS" : decision.reason, { fields });
      await finish(id, "manual_review", decision.reason, base);
      return { status: "manual_review", reason: decision.reason, tokens: meter.used };
    }
    if (decision.action !== "qualify") throw new Error("unexpected decision");

    // ---- 4. score (deterministic, explainable) ----
    const flags = [...decision.flags];
    const sc = scoreCompany({ fields, discovery: company.discovery, flags }, cfg);
    await logStep(id, "score", { score: sc.score, tier: sc.tier, lines: sc.lines, penalties: sc.penalties, icp_version: version });
    const scoreExtra = { ...base, score: sc.score, tier: sc.tier, breakdown: sc };

    if (sc.tier === "D") {
      await finish(id, "disqualified", "low_score", { ...scoreExtra, flags });
      return { status: "disqualified", reason: "low_score", tokens: meter.used };
    }
    if (sc.tier === "C" && !opts.force) {
      await openCheckpoint(id, "qualification", `score ${sc.score} is in the maybe band (${cfg.thresholds.maybe}-${cfg.thresholds.flagged - 1})`, { score: sc.score });
      await finish(id, "maybe", "maybe_band", { ...scoreExtra, flags });
      return { status: "maybe", reason: "maybe_band", tokens: meter.used };
    }

    // ---- 5. contact, 6. draft ----
    const out = await contactAndDraft(company, fields, cfg, flags, meter, sc.tier);
    await finish(id, out.status, out.reason, { ...scoreExtra, tokens: meter.used, flags: out.flags, contact: out.contact });
    return { status: out.status, reason: out.reason, tokens: meter.used };
  } catch (e) {
    if (e instanceof BudgetError) {
      await logStep(id, "budget_stop", { tokens: e.used });
      await openCheckpoint(id, "system", `token ceiling hit for this company (${e.used} tokens)`, { tokens: e.used });
      await finish(id, "manual_review", "token_budget_exceeded", { tokens: e.used, t0, version });
      return { status: "manual_review", reason: "token_budget_exceeded", tokens: e.used };
    }
    const msg = friendlyError(e);
    await logStep(id, "error", { message: msg, raw: String((e as Error).message ?? e).slice(0, 400) });
    await finish(id, "failed", msg, { tokens: meter.used, t0, version });
    return { status: "failed", reason: msg, tokens: meter.used };
  }
}

async function contactAndDraft(company: CompanyRow, fields: Fields, cfg: IcpConfig, flags: string[], meter: Meter, tier: string) {
  const id = company.id;
  const name = fields.company_name.value ?? company.name ?? company.domain;
  let contact: unknown = null;
  let chosen: Ranked | null = null;

  try {
    const people = await hunterDomainSearch(company.domain, cfg.hunter.monthlyCap);
    const small = !/series\s*(c|d|e)/i.test(fields.funding_stage.value ?? "");
    const picked = pickContact(people, small, cfg.hunter.autoAcceptScore, cfg.preferredTitleKeywords);
    chosen = picked.chosen;
    contact = { provider: "hunter", total: people.length, chosen: picked.chosen, best: picked.best, top: picked.ranked };
    await logStep(id, "contact", { provider: "hunter", found: people.length, chosen: picked.chosen, top: picked.ranked });
    if (!chosen) {
      flags.push("no_suitable_contact");
      const reason = picked.best ? `no Head/VP-level contact found; best match is "${picked.best.position}"` : "no matching person found: email needed";
      await openCheckpoint(id, "contact", reason, { top: picked.ranked, best: picked.best, total: people.length });
    }
  } catch (e) {
    if (e instanceof HunterQuotaError) {
      flags.push("hunter_quota_exhausted");
      await openCheckpoint(id, "contact", "Hunter's monthly searches are used up: enter a contact by hand (Apollo comes later)", { top: [], total: 0 });
    } else {
      flags.push("contact_lookup_failed");
      await openCheckpoint(id, "contact", `contact lookup failed: ${friendlyError(e)}`, { top: [], total: 0 });
    }
    await logStep(id, "contact_failed", { error: (e as Error).message });
  }

  let reason: string | null = null;
  if (chosen) {
    const d = await draftFor(company, fields, cfg, chosen, meter);
    if (!d.ok) { flags.push("draft_failed_validation"); reason = d.problems.join("; "); }
  }
  const status: Status = flags.length || tier === "B" ? "qualified_flagged" : "qualified";
  return { status, reason: reason ?? (flags.join(", ") || null), flags, contact };
}

// Draft the email for a chosen contact and open the right human checkpoint (H4 angle or H5 send).
export async function draftFor(company: { id: number; domain: string; name: string | null; discovery: CompanyRow["discovery"] }, fields: Fields, cfg: IcpConfig, person: Ranked, meter: Meter) {
  const id = company.id;
  // GUARDRAIL: never touch an email that was already sent (a re-run must not reset it or send it twice).
  const already = await q("SELECT 1 FROM drafts WHERE company_id=$1 AND kind='first' AND review_status IN ('sent','sending')", [id]);
  if (already.length) { await logStep(id, "draft_skipped", { why: "first email already sent" }); return { ok: true, problems: [] as string[] }; }
  const name = fields.company_name.value ?? company.name ?? company.domain;
  const profile = await getProfile();
  const evidence = evidenceMap(fields, company.discovery?.quote ?? null);
  const { draft, validation } = await draftWithValidation({ company: name, domain: company.domain, person, evidence, meter, profile, rules: cfg.email, styleNotes: cfg.emailStyleNotes });
  await q(
    `INSERT INTO drafts (company_id, kind, pains, hook_field, subject, body, original_body, validation, review_status)
     VALUES ($1,'first',$2,$3,$4,$5,$5,$6,'pending')
     ON CONFLICT (company_id, kind) DO UPDATE SET pains=$2, hook_field=$3, subject=$4, body=$5, original_body=$5, edited=false, validation=$6, review_status='pending', sent_at=NULL, outcome=NULL`,
    [id, JSON.stringify(draft.pains ?? []), draft.hook_field ?? null, draft.subject ?? "", draft.body ?? "", JSON.stringify(validation)],
  );
  await logStep(id, "draft", { hook_field: draft.hook_field, pains: draft.pains, validation }, meter.used);

  const external = draft.hook_field === "discovery_signal";
  const srcLabel: Record<string, string> = { funding_news: "funding news", hn_hiring: "a hiring post", gemini_search: "a web search" };
  if (!validation.ok) await openCheckpoint(id, "angle", `draft failed checks: ${validation.problems.join("; ")}`, { problems: validation.problems });
  else if (external) await openCheckpoint(id, "angle", `hook comes from ${srcLabel[(company.discovery?.source as string) ?? ""] ?? "outside"}, not their own site`, { hook: draft.hook_field });
  else await openCheckpoint(id, "send", "draft ready: approve & send", {});
  return { ok: validation.ok, problems: validation.problems };
}

// A human answered the H3 checkpoint: continue from there without re-scraping.
// "confirmed" = they accepted our best match; "override" = they chose someone else or typed a contact.
// The difference feeds contact accuracy and the Learning page.
export async function continueWithContact(id: number, person: Ranked, mode: "confirmed" | "override", reason?: string) {
  const { config: cfg } = await getIcp();
  const rows = await q<CompanyRow & { contact: Record<string, unknown> | null }>("SELECT id, domain, name, status, source, discovery, extra_urls, fields, flags, score, contact FROM companies WHERE id=$1", [id]);
  const c = rows[0];
  if (!c?.fields) throw new Error("company has no research yet");
  const meter = new Meter(cfg.tokensPerCompany);
  const contact = { ...(c.contact ?? {}), chosen: { ...person, override: mode === "override" }, override: mode === "override", confirmed: mode === "confirmed", override_reason: reason ?? null, decided_by_human: true };
  await q("UPDATE companies SET contact=$2 WHERE id=$1", [id, JSON.stringify(contact)]);
  const d = await draftFor(c, c.fields, cfg, person, meter);
  const flags = (c.flags ?? []).filter((f) => !["no_suitable_contact", "hunter_quota_exhausted", "contact_lookup_failed"].includes(f));
  if (!d.ok) flags.push("draft_failed_validation");
  await q("UPDATE companies SET flags=$2, status=$3, tokens=tokens+$4, updated_at=now() WHERE id=$1", [id, flags, flags.length ? "qualified_flagged" : "qualified", meter.used]);
  return d;
}
