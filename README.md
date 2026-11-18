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
Push to Git, import in Vercel, add the same env vars. Set `ACCESS_KEY` so only you can use the app.

## Guardrails in the code
Loop cap (4 extra fetches) and handoff · 60k-token ceiling per company · robots.txt + polite delay + stop on login/CAPTCHA/Cloudflare ·
private-address (SSRF) block · quotes must appear in the page text · hallucinated domains rejected · Hunter quota counter (25/month) ·
email validator (name, grounded hook, length, no placeholders) · recipient hardcoded to `OWNER_EMAIL` · atomic send claim (no double send) · optional `ACCESS_KEY`.

## Crawler-style upgrades (still single-fetch, no general crawler)
- **Sitemap lookup** (`lib/sitemap.ts`): reads the site's own `sitemap.xml` (via robots.txt, 7-day cache) to find the exact `/security`, `/careers`, `/pricing` pages instead of guessing. Only runs when the loop needs another page. Guessing is switched off when a sitemap exists.
- **Job-board APIs** (`lib/ats.ts`): for the stage check, tries Greenhouse / Lever / Ashby public JSON APIs first. Gives an exact open-role count plus compliance/security job titles (`compliance_hiring` evidence). Tokens come from the company's own links; a guessed Greenhouse token is accepted only if the board name matches. Falls back to scraping the careers page.
- Topic matching is strict: a page counts as the security page only if the path segment IS `security` / `trust-center` etc., not a product page that merely contains the word.
