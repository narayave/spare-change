import Stripe from "stripe";
import { passesSoldThisMonth } from "@/lib/db";
import { MONTHLY_PASS_CAP, PASS } from "@/lib/meter";

export async function POST(req: Request) {
  const origin = process.env.APP_URL ?? new URL(req.url).origin;

  // ponytail: count-then-sell can oversell by a pass or two under a burst. The cap is a
  // budget guard, not a hard limit; the Anthropic workspace spend limit is the hard one.
  if ((await passesSoldThisMonth()) >= MONTHLY_PASS_CAP) {
    return Response.redirect(`${origin}/?soldout=1`, 303);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PASS.priceCents,
          product_data: {
            name: "Spare Change Starter Pass",
            description: `${PASS.days} days of guided Claude use.`,
          },
        },
      },
    ],
    success_url: `${origin}/pass?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
  });

  return Response.redirect(session.url!, 303);
}
