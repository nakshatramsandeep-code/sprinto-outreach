# Sprinto Outreach Copilot

Finds ICP-fit SaaS companies itself, qualifies them with a capped agent loop, finds the right contact (Hunter.io),
drafts a personalised email (Gemini), and sends it **only to your own inbox** (Resend) after you approve.
Plan and design: [PLAN.md](PLAN.md) · Component map: [component-map.html](component-map.html)

## Run locally
1. `npm install`
2. Fill `.env.local` (see `.env.example`): `DATABASE_URL` (already set), `GEMINI_API_KEY`, `HUNTER_API_KEY`, `RESEND_API_KEY`, `OWNER_EMAIL`.
3. `npm run db:apply` (tables already created) · `npm test` · `npm run dev`
4. Open http://localhost:3000, press **Run discovery**.

## Deploy
Push to Git, import in Vercel, add the same env vars. `ACCESS_KEY` is optional and currently off for the demo (anyone with the URL can use it, but emails only ever go to `OWNER_EMAIL`). To turn protection back on, set `ACCESS_KEY` in Vercel and re-add an input for it in the UI.

## Guardrails in the code
Loop cap (4 extra fetches) and handoff · 60k-token ceiling per company · robots.txt + polite delay + stop on login/CAPTCHA/Cloudflare ·
private-address (SSRF) block · quotes must appear in the page text · hallucinated domains rejected · Hunter quota counter (25/month) ·
email validator (name, grounded hook, length, no placeholders) · recipient hardcoded to `OWNER_EMAIL` · atomic send claim (no double send) · optional `ACCESS_KEY`.

## Crawler-style upgrades (still single-fetch, no general crawler)
- **Sitemap lookup** (`lib/sitemap.ts`): reads the site's own `sitemap.xml` (via robots.txt, 7-day cache) to find the exact `/security`, `/careers`, `/pricing` pages instead of guessing. Only runs when the loop needs another page. Guessing is switched off when a sitemap exists.
- **Job-board APIs** (`lib/ats.ts`): for the stage check, tries Greenhouse / Lever / Ashby public JSON APIs first. Gives an exact open-role count plus compliance/security job titles (`compliance_hiring` evidence). Tokens come from the company's own links; a guessed Greenhouse token is accepted only if the board name matches. Falls back to scraping the careers page.
- Topic matching is strict: a page counts as the security page only if the path segment IS `security` / `trust-center` etc., not a product page that merely contains the word.

## Pages
- **Home**: KPIs (drafts ready, sent this week, reply rate, minutes per company, needs you), today's run funnel, recent activity.
- **Review queue**: every point that needs a human (H2 qualification, H3 contact, H4 angle, H5 send, H7 system), with the evidence beside the decision; keyboard j/k/a/s/e; unanswered items auto-skip after 7 days; every decision goes to the audit log.
- **Outreach / Accounts**: all drafts and all companies; an account page shows the score breakdown ("why this score"), evidence with quotes, contact ranking, editable drafts and the full decision trail.
- **Pipeline**: ready to send, awaiting reply, replied, meeting, no reply; follow-up queue at day 3/7/14 with "Draft now"; open rate once the Resend webhook is set.
- **Discover**: candidates from hiring posts, Google Search through Gemini, and funding-news RSS feeds; a site is used only once its homepage is verified; auto-queue toggle.
- **Analytics**: minutes per company, rewrite rate vs the 20%/50% limits, contact accuracy vs 60%, needs-human rate, cost per company, funnel, drop reasons, qualification rate by source; shows a banner if a kill criterion is reached.
- **ICP & Rules**: editable ICP, score weights (must total 100), thresholds, caps, email rules; versioned in Neon, live "which accounts would move" preview, reset to defaults.
- **Settings**: integration status, demo mode (locked), Sprinto sender profile (proof points need a source page), audit log.
- Scoring is deterministic code (0-100, tiers A/B/C/D), not a model opinion, so every point can be explained and re-computed.
- Optional: set `RESEND_WEBHOOK_SECRET` and point a Resend webhook at `/api/webhooks/resend` to record opens.
- Not included: HubSpot sync, scheduled (cron) runs, Apollo (planned for when Hunter's monthly searches run out).

## Evals and the feedback loop
**Evals** (`/evals`, `npm run eval`): a golden set of accounts (page snapshots + human-labelled answers: certified? B2B SaaS? stage?).
- *Extraction eval* re-runs the same extraction the pipeline uses and scores it: certified recall (never miss a certified company), accuracy, SaaS and stage accuracy, share of unverifiable quotes rejected. Release gates pass/fail, and any drop of 5+ points versus the last run is flagged as a regression.
- Every run records the model and a fingerprint of the prompt, so a wording or model change shows up in the history. The page warns when they changed since the last run.
- *Email eval* writes emails for labelled non-certified SaaS cases with a made-up contact (never sent), checks the hard rules, and asks a judge model to score specificity, role fit, tone and unsupported claims. The judge is the same model family, so it is a signal, not proof.
- Labels written by Claude are marked "draft" until you confirm them. Disqualifying an account in the Review queue adds it to the golden set automatically.
- `npm run eval -- https://your-app.vercel.app` exits non-zero if a gate fails or quality regressed (usable as a CI gate).

**Feedback loop** (`/learning`): measured signals become *suggested* rule changes, never automatic ones.
- Signals: reply outcomes, edits you make to drafts (sentence-level diff), contacts you confirm or replace (with a reason), maybe-band decisions.
- Rules (each with a minimum sample size, and silent below it): reweight the score toward what gets replies, queue the best-replying source first, ban phrases you keep deleting, shorten emails you keep cutting, raise the contact auto-accept bar, prefer job titles you choose by hand, lower the Flagged threshold if you qualify most maybes.
- *Apply* saves a **new, reversible ICP version** and logs it. A kind then stays quiet until 5 new records arrive, so applying a change cannot ratchet. Run the evals afterwards to confirm nothing got worse.
