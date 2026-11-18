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
