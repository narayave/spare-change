import Link from "next/link";
import Stripe from "stripe";
import { mintPass } from "@/lib/db";
import { PASS } from "@/lib/meter";

// Stripe redirects here after payment. We confirm the checkout is paid and mint
// its pass; reloading the page returns the same pass, never a second one.
// ponytail: no webhook, since there's no email to deliver a code to if the buyer closes
// the tab first. Add a checkout.session.completed webhook when email delivery exists.
export default async function PassPage({ searchParams }: PageProps<"/pass">) {
  const sessionId = (await searchParams).session_id;
  let code: string | null = null;

  if (typeof sessionId === "string" && sessionId.startsWith("cs_")) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
    if (session?.payment_status === "paid") code = await mintPass(session.id);
  }

  if (!code) {
    return (
      <main className="wrap stack">
        <h1>We couldn&apos;t find that payment.</h1>
        <p className="muted">
          If you were charged, reload this page in a minute. Still stuck? Contact the person who runs this site.
        </p>
        <Link href="/">Back to the start</Link>
      </main>
    );
  }

  return (
    <main className="wrap stack">
      <p className="muted small">SPARE CHANGE</p>
      <h1>Your Starter Pass is ready.</h1>
      <div className="card stack">
        <p className="code">{code}</p>
        <p className="muted small">
          This code is your pass. Write it down or take a screenshot. It&apos;s the only way back to your balance,
          and we can&apos;t look it up for you, because we don&apos;t know who you are. It works for {PASS.days} days.
        </p>
      </div>
      {/* The code rides in the #fragment, which browsers never send to a server. */}
      <a className="btn" href={`/chat#pass=${code}`}>Start my first mission</a>
    </main>
  );
}
