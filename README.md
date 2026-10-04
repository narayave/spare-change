# Spare Change

**Guided, pay-as-you-go access to Claude. No subscription, no account, and your conversations stay on your device.**

Spare Change is a small web app. You get a short-lived pass to use [Claude](https://www.anthropic.com/claude), an AI model, on something you actually need done, guided by a coach that explains things in plain language. It's designed first for people who have never used AI, but anyone who wants to try Claude without signing up for a plan can use it.

## Why

There are two common ways to try AI today, and both leave a gap:

- **Free tiers** give you a blank text box. If you've never used AI, the blank box is the hard part. You don't know what to ask or what it's good at, so you try it once and leave.
- **Paid plans** are monthly subscriptions. That's a lot to commit to when you just want to see whether AI can help with one letter, one confusing document, or one small project.

Spare Change sits in between. It offers a small, bounded amount of access with a guide built in, so a first session ends with something finished, not a shrug.

## Project goals

1. **Lower the barrier to trying AI.** Use a capable model on a real task with no subscription, no account, and nothing to install.
2. **Guide, don't just provide a box.** Start from missions (write a letter, understand a document, plan a budget, build a first web page). The coach asks one question at a time, avoids jargon, and steers toward a finished result.
3. **Private by design.** The server keeps no conversations and no identities. Chat history lives only in the user's browser.
4. **Bounded and fair.** Each deployment has a fixed monthly cap, so it never uses more than its budget. Usage is metered by what each reply actually costs, not by the clock.
5. **Easy for anyone to run.** A teacher, a library, a community group or an individual can deploy their own instance with their own Anthropic API key.
6. **Play by the rules.** Build on the official Claude API and stay within Anthropic's terms. No shared accounts, no workarounds.

## How it works

Spare Change borrows its structure from cap-and-trade:

| Concept | In Spare Change |
|---|---|
| **Cap** | Each deployment sells a fixed number of passes per month (`MONTHLY_PASS_CAP`). The home page shows how many are left. |
| **Pass** | A prepaid allowance of Claude usage that works for a set number of days. |
| **Trade** | A pass is a code (`SPARE-XXXX-XXXX-XXXX`), so you can give it to someone else, like a gift card. |
| **Metering** | Each reply deducts what it actually cost. Users see a fuel gauge ("62% left, about 140 replies") rather than tokens or a countdown clock. |

A typical visit:

1. Get a pass. Checkout runs through Stripe, and the pass code appears on the next page.
2. Pick a mission, or just start typing.
3. Work through it with Claude until you have something you can use.
4. Come back any time before the pass expires, or give the code to someone else.

## Design decisions

**Credits, not time.** Billing by the minute penalizes slow typists and people who stop to think, which is exactly the audience this is for. Billing in raw tokens means nothing to a newcomer. So a pass is metered on real usage behind the scenes and shown as a simple gauge.

**The Claude API, not a shared subscription.** Letting several people share one Claude subscription is tempting, but Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) prohibit sharing or reselling account access. The [Claude Code legal page](https://code.claude.com/docs/en/legal-and-compliance) also rules out routing other people's requests through Pro or Max plan credentials. A shared account can't keep conversations private from the other people on it, either. Spare Change uses the Claude API under Anthropic's Commercial Terms instead.

**No accounts.** The pass code is the only identity. Nothing needs a name, an email address or a password, which keeps both the privacy story and the code simple.

## Privacy model

Everything the server stores, in one table:

```sql
passes(code, stripe_session, balance_micros, initial_micros, expires_at, created_at)
```

- **Conversations stay in the browser** (localStorage). The browser sends them with each request because the Claude API is stateless, and the server never saves them.
- **The chat route never logs message content.** Errors log only an HTTP status code. See [app/api/chat/route.ts](app/api/chat/route.ts).
- **Pass codes stay out of URLs sent to the server.** They travel in POST bodies and in the URL `#fragment`, which browsers never send to the server.
- **The honest limits:**
  - Messages pass through the server on their way to Anthropic, so "we don't read them" rests on this open code, not on encryption.
  - Anthropic keeps API data for 30 days and doesn't use it for training.
  - The payment provider knows who paid for a pass. There are no conversations on the server to link to that payment.

## Architecture

```text
Home ──POST /api/checkout──▶ Stripe Checkout ──▶ /pass?session_id=…
                                                 (confirm payment, mint pass once)
                                                      │  /chat#pass=SPARE-…
                                                      ▼
Chat (browser, history in localStorage) ──POST /api/chat──▶ hold → stream from Claude → settle
```

Each reply is billed in three steps:

1. **Hold.** Before calling Claude, reserve the worst-case cost of the reply inside a `SELECT … FOR UPDATE` transaction. Two tabs using one pass at once queue up instead of spending the same balance twice.
2. **Stream.** Send Claude's reply to the browser as it's generated.
3. **Settle.** Replace the hold with the real cost reported by the API, never letting the balance go below zero. If a request fails, it costs the user nothing.

Stack:

- Next.js (App Router) and TypeScript.
- The Anthropic TypeScript SDK, calling Claude Sonnet 5.5 with prompt caching.
- Postgres for the single table.
- Stripe Checkout for payments.

## Run it locally

You need Node 22 or newer, an [Anthropic API key](https://console.anthropic.com), and a [Stripe test key](https://dashboard.stripe.com/test/apikeys).

```bash
npm install
cp .env.example .env.local        # add your Anthropic and Stripe test keys
npm run db                        # embedded Postgres (PGlite) on :5432, nothing else to install
npm run dev                       # http://localhost:3000
npm test                          # tests for metering, holds and input validation
```

Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry date and any CVC.

## Deploy your own

1. In the Anthropic Console, create a dedicated workspace with a **monthly spend limit**. That limit is the hard ceiling for the deployment.
2. Provision Postgres (Neon, Supabase, RDS or any other). The table is created automatically on the first request.
3. Deploy to Vercel or any Node host with the environment variables below.

### Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for the deployment's workspace. |
| `STRIPE_SECRET_KEY` | Stripe key (`sk_test_…` while testing). |
| `DATABASE_URL` | Postgres connection string. |
| `MONTHLY_PASS_CAP` | Passes available per calendar month. Keep it so that cap × usage per pass fits under your workspace spend limit. |
| `APP_URL` | Public URL for payment redirects. Optional; defaults to the request's origin. |

Pass settings live in [lib/meter.ts](lib/meter.ts):

- `PASS.priceCents`: the pass price.
- `PASS.creditMicros`: how much usage a pass includes.
- `PASS.days`: how long a pass lasts.
- `MODEL` and `RATE`: the model and its per-token prices.

Set the pass price high enough to cover the usage it includes plus payment processing fees.

## Project layout

| Path | What it does |
|---|---|
| [lib/meter.ts](lib/meter.ts) | Pricing, holds, settlement, pass codes, request validation. Pure functions, tested in [lib/meter.test.ts](lib/meter.test.ts). |
| [lib/db.ts](lib/db.ts) | The single table: minting passes, row-locked holds, settlement. |
| [lib/coach.ts](lib/coach.ts) | The coach system prompt and the starter missions. |
| [app/api/chat/route.ts](app/api/chat/route.ts) | Hold, stream from Claude, settle. |
| [app/api/checkout/route.ts](app/api/checkout/route.ts), [app/pass/page.tsx](app/pass/page.tsx) | Checkout and pass minting. |
| [app/chat/page.tsx](app/chat/page.tsx) | Chat UI, fuel gauge and mission picker. |

## Roadmap

- [ ] **Pass it on:** donate an unused balance to a shared pool that gives free passes to newcomers.
- [ ] Optional email delivery of pass codes, plus a payment webhook, so closing the tab before the code appears doesn't lose a pass.
- [ ] Rate limiting on pass lookups.
- [ ] More missions, and translations of the coach and missions.
- [ ] A choice of model per deployment (for example, Haiku for longer-lasting passes).

Suggestions and pull requests are welcome, especially new missions and accessibility improvements.

## License

[MIT](LICENSE)
