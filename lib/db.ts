import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

// Thin helper: parameterised query returning rows.
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await sql().query(text, params);
  return rows as unknown as T[];
}

export async function logStep(
  companyId: number | null,
  step: string,
  detail: Record<string, unknown>,
  tokens = 0,
) {
  await q("INSERT INTO steps (company_id, step, detail, tokens) VALUES ($1,$2,$3,$4)", [
    companyId,
    step,
    JSON.stringify(detail),
    tokens,
  ]);
}
