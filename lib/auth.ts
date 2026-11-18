// Guardrail: if ACCESS_KEY is set, every API call must carry it.
// Stops strangers spending your Gemini / Hunter / Resend quotas on a public Vercel URL.
export function checkAccess(req: Request): Response | null {
  const key = process.env.ACCESS_KEY;
  if (!key) return null;
  if (req.headers.get("x-access-key") === key) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
