import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/coach";
import { hold, settle } from "@/lib/db";
import { MAX_OUTPUT_TOKENS, MODEL, costMicros, estimateMicros, parseChat } from "@/lib/meter";

const client = new Anthropic();

// PRIVACY: this handler never logs, stores, or forwards message content anywhere
// except to the Claude API. The only thing written is the pass balance.
export async function POST(req: Request) {
  const chat = parseChat(await req.json().catch(() => null));
  if (!chat) return Response.json({ error: "bad_request" }, { status: 400 });

  const held = await hold(chat.code, estimateMicros(chat.chars, SYSTEM_PROMPT.length));
  if (held === null) return Response.json({ error: "pass_empty_or_expired" }, { status: 402 });

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: "low" }, // chat: low effort skips thinking on simple turns
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    cache_control: { type: "ephemeral" }, // auto-caches the growing conversation tail
    messages: chat.messages,
    // Retries cyber/frontier-LLM declines on Sonnet 5, which costs the same per
    // token, so billing from the final usage stays correct.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {} // reader went away; keep going so the reply is still billed correctly
      };
      stream.on("text", send);

      let cost = 0;
      try {
        const message = await stream.finalMessage();
        cost = costMicros(message.usage);
        if (message.stop_reason === "refusal") send("\n\n(I can't help with that one. Try asking a different way.)");
        if (message.stop_reason === "max_tokens") send('\n\n(That reply got long and was cut off. Say "continue" to get the rest.)');
      } catch (err) {
        // ponytail: a failed stream has no usage to bill, so it's free to the user and the
        // operator eats any partial output. Upgrade: bill partial usage from message_delta events.
        console.error("chat stream failed", err instanceof Anthropic.APIError ? err.status : "network");
        send("\n\n(Something went wrong on our side. You weren't charged for this reply, so please try again.)");
      } finally {
        await settle(chat.code, held, cost);
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
