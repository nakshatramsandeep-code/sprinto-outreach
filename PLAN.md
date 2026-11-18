# Sprinto Cold Outreach at Scale — Build Plan (B2)

Status: **PLAN ONLY. Nothing is built.** Sources: *ai build.pdf* (the case) and *MESA T2-L4 Scraping and Agent Loops.pdf* (the lecture).
Visual component map: [component-map.html](component-map.html)

---

## 1. The problem in one paragraph

Sprinto's Growth Lead hand-researches 8–15 prospects a week at 15–20 min each. Quality drops toward the end of the list because the writer is tired, not because the companies are worse. We build a **repeatable** system: give it a list of domains, and it (1) scrapes each site, (2) extracts structured data, (3) qualifies against an ICP **that we define and defend**, using an agent loop that fetches more pages when evidence is thin, (4) finds the right decision-maker, (5) names that person's two most likely pain points, (6) drafts a personalised email addressed by name with a specific hook, (7) sends it through Gmail, **hardcoded to our own address** for this build.

"Done" = a personalised email lands in our inbox for a real named person with a hook a human would answer, **and** we can defend every decision (why this company, why this person, why this email).
The failure mode we design against: a pipeline that qualifies everything, emails everyone, and picks "the nearest person with *manager* in the title". That is activity, not work. Test: *would the Growth Lead redo this before using it?*

---

## 2. The Nine Checks (is B2 worth building?)

| # | Check | Type | Answer | Defence |
|---|---|---|---|---|
| 01 | Problem real? | Kill switch | **YES** | 15–20 min per company × 8–15/week ≈ 2–5 hrs/week, and quality visibly decays by the end of the list. |
| 02 | Workflow repeated? | Kill switch | **YES** | Same research steps for every new prospect, every week. |
| 03 | Input available? | Kill switch | **YES, with a constraint** | Company sites are public. Contact data via Hunter.io first (free tier = **25 searches/month**), then Apollo once Hunter's quota is used up. The quota is the real limit, so we qualify first, call Hunter only for qualified companies, and cache results. |
| 04 | Output valuable? | Sizing | **YES** | A qualified lead plus a drafted, evidence-backed email plus a reasoning trail is directly actionable. |
| 05 | Impact measurable? | Sizing | **YES** | Time per company, share of emails rewritten, PoC accuracy, later pipeline conversion. |
| 06 | ROI worth it? | Sizing | **YES** | Run cost is cents (cleaned text ≈ 500 words/company on a cheap model). Hours of Growth Lead time saved weekly. |
| 07 | Failure risk OK? | Boundary | **PARTIAL** | Bad email to a real prospect is a brand risk; stale PoC data; scraping and personal-data rules (GDPR / DPDP). Mitigation: all sends go to our own inbox in this build. |
| 08 | Judgment protected? | Boundary | **PARTIAL** | Humans set the ICP; the model only applies it. Model never decides "enough evidence", code does. Growth Lead approves any real send. |
| 09 | Owner clear? | Boundary | **YES** | Growth Lead owns the ICP, the output and the decision to send. We own the pipeline's reliability. |

**The cut (from 07 + 08):** the system does research and drafting. **A human does the send.** No email reaches a real prospect without review.
No kill switch fired and nothing needs to be made smaller. Both boundary items become hard design rules (see §4 and §5).

---

## 3. The Five Pre-Build Decisions

1. **Outcome definition**
   Cut prospect research + first-draft time from 15–20 min to **under 2 min per company** for the Growth Lead, with draft quality at least as good as hand-written, measured by time-to-draft (logged per run) and rewrite rate.
2. **Baseline**
   8–15 companies/week, 15–20 min each, fully manual, quality inconsistent late in the list. Capture the real numbers from the Growth Lead before launch (she may disagree with the case figures).
3. **Workflow change**
   The Growth Lead moves from researcher-and-writer to **reviewer-and-sender**. She supplies the domain list and ICP sign-off, reads the reasoning trail, approves or edits, then sends. Failures and flagged companies land in a review queue instead of silently disappearing.
4. **Measurement plan (90 days)**
   Per-company wall-clock under 2 min · Growth Lead rewrites **under 20%** of emails (UI captures "sent as-is / edited / rejected") · PoC accuracy tracked by spot-check · reply/pipeline conversion holds or improves versus the manual baseline.
5. **Kill criterion**
   Shut down if **any** of: rewrite rate **above 50%** · running the system takes more Growth Lead time than it saves · PoC accuracy **below 60%**.

---

## 4. What we are building

### 4.1 The 7-step pipeline (with the loop at step 3)

| Step | What happens | How |
|---|---|---|
| 1 Scrape | Single-fetch scraper, narrowest scope and legal exposure. Check `robots.txt` first, polite delay, cache. Plain HTTP first; if the clean text is under ~200 words, retry through a JS-rendering fallback (Jina Reader or Firecrawl). | `fetch` + cheerio |
| 2 Extract | Clean (strip nav/footer/cookie banners, dedupe, keep hero/product/about, **cap ~2,000 tokens**) then model extracts **named fields**. | Gemini Flash-class model, JSON-schema output |
| 3 Qualify (loop) | Code checks which fields are still null. If one blocks the verdict, fetch the named page for it. Re-extract, re-check. Stop at the cap. | Code decides "enough"; model only judges |
| 4 Find PoC | **Hunter.io Domain Search first.** When Hunter's monthly quota is spent (tracked in Neon), switch to **Apollo**. Then rank people by role fit (rules below). | Hunter API; Apollo free tier has no API, so see 4.5 |
| 5 Pain points | Two most likely pains for **that person's role**, each tied to a piece of evidence we actually collected. | Gemini Pro-class model |
| 6 Draft email | Addressed by first name, a specific hook citing evidence, short, one clear ask. Code validates it (no placeholders, name present, hook references a real evidence field, length). | Gemini Pro-class model + validator |
| 7 Send | Resend API, `to:` hardcoded from an env var to our own address. Body header shows the would-be recipient. | Resend (`RESEND_API_KEY` set by you as a Vercel env var) |

### 4.2 Our ICP definition (the first decision we must defend)

Qualify when the company is **B2B SaaS**, at a **growth stage where certification becomes a sales blocker** (roughly Series A–C, ~30–500 staff), **not already certified** in the frameworks Sprinto sells (SOC 2, ISO 27001, GDPR), and shows **compliance pressure**.
Strongest pressure signals: hiring security/compliance/GRC roles, enterprise tier or "contact sales" on pricing, enterprise logos on customers page, a security/trust page that is absent or thin.

### 4.3 Evidence Map (what the loop uses to decide "enough")

| Question | Data that settles it | Where it lives | Sufficient when (code-checkable) | Fetch limit | If unanswered | Short-circuit |
|---|---|---|---|---|---|---|
| Already certified? | Named certification or trust page | footer, `/security`, `/trust` | any named cert string present (SOC 2, ISO 27001…) | 1 | treat as not certified, **flag** | **YES** — disqualify and stop |
| B2B SaaS? | Product description naming a business buyer | homepage hero, `/product`, `/about` | description names who buys it | 1 | `manual_review` | **NO** → disqualify and stop |
| Right stage? | Funding stage, headcount, enterprise customers, open-role count | `/careers`, `/pricing`, `/customers` | any one of: funding stage named, 5+ open roles, enterprise tier on pricing | 2 | qualify at lower rank, **flagged** | — |
| Worst case | | | | **4 fetches beyond the homepage** | | |

Careers page is rung one for stage: it answers headcount, seniority and often funding in one request.
**Final question answered:** two of three answered and one unknown → **qualify-and-flag** (lower rank, never silently drop, never silently pass).

### 4.4 Loop guardrails

- **Hard cap:** 4 extra fetches per company, set before building. At the cap the result is a **handoff to human**, not "try harder".
- **Run-level cost ceiling:** token budget per company and per batch. Exceed it and the job stops and is flagged.
- **Failure ladder (in order):** check if scraping is needed at all → slow down, cache → real browser/fallback → give up gracefully (log reason, move on, queue for human) → **stop** on login wall, CAPTCHA, or robots/ToS prohibition. We never bypass those.
- **Silent-failure checks:** six of eight common scraper failures give no error. So after every fetch, code verifies: word count, share of boilerplate, expected fields filled. Anything suspicious is logged as a failure, not passed along as data.

### 4.5 PoC selection rules (not "nearest manager")

Rank Hunter results by: (1) role fit — Head/VP Security, CISO, Head of Compliance/GRC; at under ~50 staff, CTO / VP Eng / founder; (2) seniority and department match; (3) Hunter confidence score and verification status. Require a name and a role. If nobody clears the bar, flag **no suitable PoC** — do not email a random person.
**Provider order:** Hunter first. A `hunter_budget` counter in Neon tracks searches used; at 25 (or on a quota error) the router moves to Apollo. Apollo's free tier is web-UI only, so the Apollo path reads a **contacts CSV you export from the Apollo UI beforehand** (columns: domain, name, title, email), loaded into Neon. No Apollo login or API key is needed by the system. If neither provider has anyone suitable: flag "no suitable PoC".
Spend Hunter quota only on qualified companies and cache every result (25 searches/month).

### 4.6 Data model (Neon Postgres)

- `icp_config` — versioned ICP rules, thresholds, caps (so a run can be reproduced)
- `runs` — batch id, started/finished, totals, cost
- `companies` — domain, status (`qualified`, `qualified_flagged`, `disqualified`, `manual_review`, `failed`), rank, reason code
- `pages_cache` — url, cleaned text, fetched_at, fetch_method, word_count (TTL ~7 days)
- `extractions` — per company: named fields, quote + source URL per field
- `loop_steps` — iteration number, which field was missing, which page fetched, outcome
- `contacts` — Hunter result, chosen PoC, ranking reasons, `hunter_budget` counter
- `drafts` — pain points, evidence refs, subject, body, validator result, review status (`as_is` / `edited` / `rejected`)
- `decision_log` — every step: inputs, output, model, tokens, cost, timestamp (the "defend every decision" ledger)

### 4.7 Hosting and tools

| Need | Choice |
|---|---|
| Hosting + UI + API | **Vercel**, Next.js (App Router, TypeScript) |
| Database | **Neon** Postgres (via `@neondatabase/serverless` + Drizzle) |
| Job running | One company per function invocation, jobs in a Neon queue table, drained by a route handler (cron or button), so no single serverless call has to process the whole batch |
| LLM | **Gemini API** (your key): a fast Flash-class model for extract/qualify, a stronger Pro-class model for pain points and email. Confirm current model IDs and free-tier rate limits before building; the free tier may need pacing between calls |
| Scrape | `fetch` + cheerio, `robots.txt` parser; Jina Reader or Firecrawl as JS-rendering fallback (headless Chrome is awkward on serverless) |
| Contacts | Hunter.io Domain Search first, Apollo CSV import when Hunter is exhausted |
| Email | **Resend API** (replaces Gmail; the case brief says Gmail, so we note this as a deliberate swap: same outcome, an email arrives in our inbox, and no mailbox password is needed). Resend's default test sender can only deliver to the account owner's own address (confirm in their docs), which matches the hardcoded-to-self rule. No domain setup needed for this build; a verified domain is only needed if real prospects are ever emailed |
| Secrets | Vercel env vars you set yourself: `GEMINI_API_KEY`, `HUNTER_API_KEY`, `RESEND_API_KEY`, `DATABASE_URL`, `OWNER_EMAIL`. Never committed, never pasted in chat |

### 4.8 UI (minimal)

1. Paste/upload domains → Run.
2. Table of companies with status chips (qualified / flagged / disqualified + reason / failed).
3. Company detail: **"Why" trail** (evidence quotes with URLs, loop steps, PoC ranking, pain points), the draft, and **Approve & Send** (to own inbox) / Edit / Reject.
4. Review queue for flagged and failed companies.

---

## 5. Component map

See the swimlane diagram in [component-map.html](component-map.html) (same format as your Freshroots reference: Actor × Trigger / Input / Context / Processing / Output).
Flow: ① Growth Lead uploads domains → ② run controller dedupes, checks cache, enqueues → ③ scraper fetches homepage → ④ clean + extract named fields → ⑤ ICP + Evidence Map rules (config) → ⑥ qualify loop (code checks gaps, fetches next page, cap 4) → ⑦ PoC lookup: Hunter first, Apollo CSV when Hunter's quota is spent → ⑧ pain points + email draft + validator → ⑨ Neon stores everything → ⑩ review UI → ⑪ Growth Lead approves → ⑫ Resend sends to own inbox.
**Out of scope:** real-recipient sending, CRM integration, login-gated sites, LinkedIn scraping, crawling, scheduled monitoring, self-tuning ICP.

---

## 6. Build order (when you say go)

1. Neon schema + config + decision logging (everything else writes to it).
2. Scraper + cleaner, tested on ~10 saved pages. Verify output is clean and under cap.
3. Extraction with named fields.
4. Qualify loop with code-side gap check, cap, handoff.
5. Hunter PoC + ranking (mock with a saved response first to save quota).
6. Pain points + email draft + validator.
7. Gmail send to own inbox.
8. Minimal UI + Vercel deploy.
9. Run the test set and write up the results against the Nine Checks and kill criteria.

**Test set (10 domains):** 3 clear fits · 2 already SOC 2 certified (must short-circuit) · 2 non-SaaS · 2 thin homepage (must trigger the loop) · 1 behind Cloudflare (must fail gracefully).

**Done when:** email arrives for a real named person; every field of the "why" trail is populated; short-circuits fire; the cap hands off instead of looping; failures are logged with reasons; total cost per company is under a few cents.

---

## 7. Risks and honest limits

- Hunter free tier (25/month) caps how many PoCs we can test. Cache hard and mock in development.
- PoC data can be stale, so show Hunter's confidence and verification status next to the name.
- Legal: respect `robots.txt` and ToS; collect only business-contact data; no login, CAPTCHA or bot-detection evasion.
- A fluent email can sit on weak evidence, so the validator links each claim to a stored evidence field.
- Our moat versus a product like Pocus is not the pipeline; it is customer-owned data and conversion outcomes. Logging draft outcomes from day one starts that dataset.

## 8. Open questions for you

Resolved: Hunter first then Apollo; Gemini API key; Resend for email; no passwords or logins shared with me.
Resolved: Apollo is skipped until Hunter runs out; the CSV import is built only when needed (Hunter's 25 searches are used up).
Resolved: Next.js + TypeScript on Vercel. No real baseline numbers exist, so the case figures (15–20 min per company, 8–15 per week) are used as the baseline.
Nothing is open. Build only on your go.

---

## 9. Simplified architecture and flow (the version we build)

**Principle: one app, one database, one pipeline function.** No queue, no workers, no cron. The browser calls one API route per company, one after another, so each call stays short.

### Architecture

```
Growth Lead (browser)
   |  click "Run discovery" (no domains typed in)
   v
Next.js app on Vercel
   |-- UI: Run discovery button, results table, "why" page, Approve & Send
   |-- API route  /api/discover      (finds candidate companies from the internet)
   |        '-- Gemini + Google Search grounding, Hacker News hiring API
   |-- API route  /api/run-company   (does one company end to end)
   |        |-- scraper (fetch + cheerio + robots.txt)
   |        |-- Gemini (extract, loop judgment, pains, email)
   |        |-- Hunter.io (contact lookup)
   |        '-- Resend (send)
   '-- API route  /api/send          (after approval)
   v
Neon Postgres (4 tables)
```

**Four tables only:** `companies` (status, reason, chosen contact, rank) · `pages` (url, cleaned text, fetched_at; 7-day cache) · `steps` (every decision: step, input, output, evidence quote + URL, tokens) · `drafts` (pains, subject, body, review status). The ICP rules, caps and Hunter counter live in one config file and one small counter row, not extra tables.

### Flow, one company

0. **Discover:** Growth Lead clicks Run discovery. The system finds candidate companies itself (see section 10) and returns up to N new domains, each with the signal that surfaced it.
1. **Input:** the UI sends those discovered domains to the pipeline one at a time.
2. **Cache check:** researched in the last 7 days? Reuse it, skip to the result.
3. **Scrape homepage:** check `robots.txt`, plain fetch. If under ~200 words, retry via Jina Reader. Blocked, login or CAPTCHA? Log reason, mark `failed`, stop.
4. **Clean:** drop nav, footer, cookie text, duplicates; keep hero, product, about; cap ~2,000 tokens.
5. **Extract:** Gemini Flash fills named fields: is_b2b_saas, buyer, certifications_found, funding_stage, open_roles, enterprise_signal. Each field carries a quote and source URL, or null.
6. **Loop (max 4 extra fetches):** code checks the fields.
   - Certification found → **disqualify, stop.**
   - Not B2B SaaS → **disqualify, stop.**
   - Stage unknown → fetch the next page in order `/security` → `/careers` → `/pricing` → `/customers`, clean, extract again, re-check.
   - Cap reached with gaps → **qualify and flag** (lower rank) for human review.
7. **Find contact (qualified only):** Hunter Domain Search, rank by role fit (security/compliance head, else CTO/VP Eng/founder at small companies), prefer high confidence and verified. None suitable → flag "no suitable contact".
8. **Pain points:** Gemini Pro names two for that role, each tied to a stored evidence quote.
9. **Draft email:** addressed by first name, one specific hook, short, one ask. Code validates: name present, no placeholders, hook matches an evidence field, length.
10. **Save:** everything written to Neon; row appears in the results table.
11. **Review:** Growth Lead opens the "why" page (evidence, loop steps, contact ranking, pains, draft). Approve, edit or reject.
12. **Send:** Resend delivers to the hardcoded own address, with the would-be recipient shown at the top.

### What is deliberately left out
(The Growth Lead no longer supplies a domain list. Discovery replaces it. See section 10.)


Queues, workers, scheduler, CRM, auth and user accounts (single user, link not public), headless browser, crawling, real-recipient sending, Apollo (until Hunter runs out).

### Build order (unchanged, on your go)

Schema and logging → scraper and cleaner → extract → loop → Hunter → pains and email → Resend → UI and Vercel deploy → run the 10-domain test set.

---

## 10. Discovery stage (the system finds the companies)

You no longer type domains. Discovery turns the ICP into searches, finds candidates, and hands only new domains to the pipeline.

**Sources, kept to two so it stays simple**
1. **Gemini with Google Search grounding** (your Gemini key, no extra service). Queries are generated from the ICP signals, for example: "B2B SaaS Series A hiring first compliance manager", "SaaS startup hiring security engineer SOC 2", "startup announces Series B enterprise customers security review", "SaaS company working towards SOC 2 / ISO 27001". The model returns company names and domains with the page that supports each one.
2. **Hacker News "Who is hiring" via the free Algolia API** (no key). Search monthly threads for SOC 2 / compliance / security-hire mentions, which is a structured hiring signal with the company name and posting text.

We do **not** scrape Google results pages or LinkedIn directly (against their terms). Grounded search through the API is the allowed route.

**How it works**
1. Build 5–8 queries from the ICP config (one per pressure signal).
2. Run them through the two sources; collect candidate company name, domain, signal quote, signal URL.
3. Normalise to root domains, drop duplicates, drop anything already in `companies` (researched in last 7 days) and obvious non-fits (big enterprises, agencies, Sprinto's competitors such as Vanta or Drata).
4. Keep the top N by signal strength (N = 10 by default, matching 8–15 a week), pass to the normal pipeline.
5. Store the **discovery signal** with each company, so "why this company" starts from the real-world trigger (for example "posted a Compliance Manager role"), not just the homepage.

**Guardrails**
- Cap on queries and candidates per run (cost and Hunter's 25 searches/month).
- A grounded search can return a wrong or hallucinated domain, so every candidate domain must load (HTTP 200) and its homepage must match the claimed company name before it enters the pipeline.
- Discovery is a button for now, no cron. A weekly scheduled run can be added later.
- Same legal rules: `robots.txt`, no logins, no personal data scraped; contacts come only from Hunter.

**Defensibility:** the `steps` table gets one extra row type, `discovery`, holding query, source, quote and URL.
