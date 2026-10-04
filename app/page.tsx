import { connection } from "next/server";
import { passesSoldThisMonth } from "@/lib/db";
import { MONTHLY_PASS_CAP, PASS } from "@/lib/meter";

export default async function Home({ searchParams }: PageProps<"/">) {
  await connection(); // the cap meter is live, never prerendered
  const sold = await passesSoldThisMonth();
  const left = Math.max(MONTHLY_PASS_CAP - sold, 0);
  const soldOut = left === 0 || (await searchParams).soldout !== undefined;

  return (
    <main className="wrap stack">
      <section className="hero stack">
        <p className="muted small">SPARE CHANGE</p>
        <h1>Try AI on something real, for the price of a coffee.</h1>
        <p className="muted">
          A ${PASS.priceCents / 100} Starter Pass gets you {PASS.days} days with Claude, an AI model, and a
          patient guide that works even if you&apos;ve never used AI before. No subscription, no account, nothing to install.
        </p>
      </section>

      <section className="card stack">
        <div>
          <strong className="display" style={{ fontSize: "1.4rem" }}>
            {left} of {MONTHLY_PASS_CAP} passes left this month
          </strong>
          <p className="muted small">
            Each month has a fixed number of passes, so the service never spends more than it can afford.
          </p>
        </div>
        <div className="meter" aria-hidden>
          <span style={{ width: `${(left / MONTHLY_PASS_CAP) * 100}%` }} />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <form action="/api/checkout" method="post">
            <button className="btn" disabled={soldOut}>
              {soldOut ? "Sold out until next month" : `Get a Starter Pass, $${PASS.priceCents / 100}`}
            </button>
          </form>
          <a className="btn ghost" href="/chat">I have a pass code</a>
        </div>
      </section>

      <section className="steps">
        <div className="card">
          <h3>1. Pick a mission</h3>
          <p className="muted small">Write a letter, understand a document, plan a budget, build a web page.</p>
        </div>
        <div className="card">
          <h3>2. Get a guide, not a blank box</h3>
          <p className="muted small">Claude asks one question at a time and explains in plain words.</p>
        </div>
        <div className="card">
          <h3>3. Walk away with something</h3>
          <p className="muted small">A finished result you made, and a feel for what AI is good at.</p>
        </div>
      </section>

      <section className="card stack">
        <h2>Private by design</h2>
        <p className="muted">
          Your pass code is the only thing that identifies you. Your conversations are kept only in your browser.
          The server stores a balance and an expiry date, never what you wrote or what Claude replied. The code is
          open source, so anyone can check.
        </p>
        <p className="muted small">
          Messages pass through to Anthropic&apos;s API to get a reply, and Anthropic deletes API data after 30 days
          and doesn&apos;t train on it. A pass is like a gift card: anyone with the code can use the balance, so you
          can give it to a friend.
        </p>
      </section>
    </main>
  );
}
