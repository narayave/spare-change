import postgres from "postgres";
import { PASS, holdMicros, newCode, settleBalance } from "./meter";

// The only state the server keeps. Note what's missing: no messages, no prompts,
// no replies, no names, no emails. stripe_session lets a paid checkout mint
// exactly one pass, even if the success page is reloaded.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS passes (
  code           text PRIMARY KEY,
  stripe_session text UNIQUE,
  balance_micros integer NOT NULL CHECK (balance_micros >= 0),
  initial_micros integer NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
)`;

const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/postgres", {
  max: Number(process.env.DATABASE_POOL ?? 5),
  onnotice: () => {}, // "relation already exists" on every cold start
});

let ready: Promise<unknown> | undefined;
const db = async () => {
  ready ??= sql.unsafe(SCHEMA);
  await ready;
  return sql;
};

export type PassStatus = { balance: number; initial: number; expiresAt: string; expired: boolean };

export async function getPass(code: string): Promise<PassStatus | null> {
  const s = await db();
  const [row] = await s`
    SELECT balance_micros, initial_micros, expires_at, expires_at <= now() AS expired
    FROM passes WHERE code = ${code}`;
  if (!row) return null;
  return {
    balance: row.balance_micros,
    initial: row.initial_micros,
    expiresAt: new Date(row.expires_at).toISOString(),
    expired: row.expired,
  };
}

// Idempotent: the same paid checkout always maps to the same pass.
export async function mintPass(stripeSession: string | null): Promise<string> {
  const s = await db();
  const [row] = await s`
    INSERT INTO passes (code, stripe_session, balance_micros, initial_micros, expires_at)
    VALUES (${newCode()}, ${stripeSession}, ${PASS.creditMicros}, ${PASS.creditMicros},
            now() + make_interval(days => ${PASS.days}))
    ON CONFLICT (stripe_session) DO UPDATE SET stripe_session = EXCLUDED.stripe_session
    RETURNING code`;
  return row.code;
}

export async function passesSoldThisMonth(): Promise<number> {
  const s = await db();
  const [row] = await s`SELECT count(*)::int AS n FROM passes WHERE created_at >= date_trunc('month', now())`;
  return row.n;
}

// Take a hold on the pass before calling Claude. The row lock makes concurrent
// requests on one pass queue up instead of both spending the same cents.
export async function hold(code: string, estimate: number): Promise<number | null> {
  const s = await db();
  return s.begin(async (tx) => {
    const [row] = await tx`
      SELECT balance_micros FROM passes
      WHERE code = ${code} AND expires_at > now()
      FOR UPDATE`;
    const held = row ? holdMicros(row.balance_micros, estimate) : null;
    if (held !== null) await tx`UPDATE passes SET balance_micros = balance_micros - ${held} WHERE code = ${code}`;
    return held;
  });
}

// Replace the hold with the real cost of the reply.
export async function settle(code: string, held: number, cost: number): Promise<void> {
  const s = await db();
  await s.begin(async (tx) => {
    const [row] = await tx`SELECT balance_micros FROM passes WHERE code = ${code} FOR UPDATE`;
    if (row) await tx`UPDATE passes SET balance_micros = ${settleBalance(row.balance_micros, held, cost)} WHERE code = ${code}`;
  });
}
