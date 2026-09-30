import { NextResponse } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { getPlan, initializeSubscription } from "@/lib/billing/paystack";
import { publicEnv } from "@/lib/env";

/** Creates a Paystack transaction for the Pro plan and returns its access code for the inline popup. */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (viewer.plan === "pro") return NextResponse.json({ error: "You're already on Pro." }, { status: 409 });

  const plan = await getPlan();
  if (!plan) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });

  try {
    const { access_code } = await initializeSubscription({
      email: viewer.user.email,
      userId: viewer.user.id,
      amount: plan.amount,
      callbackUrl: `${publicEnv.siteUrl}/pricing?paid=1`,
    });
    return NextResponse.json({ accessCode: access_code });
  } catch (err) {
    console.error("[paystack] initialize failed", err);
    return NextResponse.json({ error: "Couldn't start checkout. Please try again." }, { status: 502 });
  }
}
