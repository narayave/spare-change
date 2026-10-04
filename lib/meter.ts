// The money path: what a pass costs, what it holds, what a reply costs, and what
// a chat request is allowed to look like. No I/O here, so it's all unit-tested.

export const MODEL = "claude-sonnet-5-5";

// Claude Sonnet 5.5 list price, in dollars per million tokens. Conveniently that's
// the same number as micro-dollars (µ$) per token, which is the unit balances use.
export const RATE = { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 };

export const PASS = {
  priceCents: 500, // what the newcomer pays
  creditMicros: 2_500_000, // $2.50 of Claude usage; the rest covers payment processing (~$0.45) and hosting
  days: 7,
};

// The "cap" in cap-and-trade: passes sold per calendar month, sized to the
// operator's Anthropic spend limit (cap x PASS.creditMicros <= monthly API budget).
export const MONTHLY_PASS_CAP = Number(process.env.MONTHLY_PASS_CAP ?? 200);

export const MAX_OUTPUT_TOKENS = 4000;
export const MAX_TURNS = 60;
export const MAX_CHARS = 60_000; // whole conversation; roughly 20k tokens
export const MIN_BALANCE_MICROS = 5_000; // below half a cent the pass counts as used up
export const TYPICAL_REPLY_MICROS = 12_000; // for the "about N replies left" estimate only

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function costMicros(u: Usage): number {
  return Math.ceil(
    u.input_tokens * RATE.input +
      u.output_tokens * RATE.output +
      (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * RATE.cacheRead,
  );
}

// Worst case for one reply, held before the call and settled after it. Assumes
// ~2 chars per token (the tokenizer is never that dense on English) and that every
// input token is a cache write, the priciest input rate.
export function estimateMicros(chars: number, systemChars: number): number {
  return Math.ceil(((chars + systemChars) / 2) * RATE.cacheWrite + MAX_OUTPUT_TOKENS * RATE.output);
}

// How much to hold against a balance: the estimate, or whatever is left if that's
// less (so the last few cents are usable). null means the pass can't take a turn.
export function holdMicros(balance: number, estimate: number): number | null {
  return balance < MIN_BALANCE_MICROS ? null : Math.min(balance, estimate);
}

// New balance after the reply: refund what the hold over-covered, or take the
// overrun, never going below zero (the operator eats a few-cent overrun).
export function settleBalance(balance: number, held: number, cost: number): number {
  return Math.max(balance + held - cost, 0);
}

export function repliesLeft(balance: number): number {
  return Math.floor(balance / TYPICAL_REPLY_MICROS);
}

// Pass codes: SPARE-XXXX-XXXX-XXXX, 60 random bits, no look-alike characters.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 symbols, no I/L/O/0/1
export const CODE_RE = /^SPARE-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `SPARE-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Trust boundary for /api/chat. Returns null for anything malformed rather than
// trying to repair it.
export function parseChat(body: unknown): { code: string; messages: ChatMessage[]; chars: number } | null {
  if (!body || typeof body !== "object") return null;
  const { code: rawCode, messages } = body as { code?: unknown; messages?: unknown };
  const code = normalizeCode(rawCode);
  if (!code || !Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS) return null;

  let chars = 0;
  for (const [i, m] of messages.entries()) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== (i % 2 === 0 ? "user" : "assistant")) return null; // strict user/assistant alternation
    if (typeof content !== "string" || content.trim() === "") return null;
    chars += content.length;
  }
  if (messages.length % 2 === 0 || chars > MAX_CHARS) return null; // must end on the user's turn

  return {
    code,
    messages: messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
    chars,
  };
}
