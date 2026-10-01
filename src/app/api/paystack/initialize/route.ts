import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { getPlan, initializeSubscription } from "@/lib/billing/paystack";
import { publicEnv } from "@/lib/env";
import { PAID_PLANS, PLAN_LIMITS, PLAN_RANK, type PaidPlanId } from "@/lib/plans";

/** Creates a Paystack transaction for a paid plan and returns its access code for the inline popup. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { tier?: unknown };
  const tier = PAID_PLANS.includes(body.tier as PaidPlanId) ? (body.tier as PaidPlanId) : "pro";

  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (PLAN_RANK[viewer.plan] >= PLAN_RANK[tier]) {
    return NextResponse.json({ error: `You're already on ${PLAN_LIMITS[viewer.plan].label}.` }, { status: 409 });
  }

  const plan = await getPlan(tier);
  if (!plan) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });

  try {
    const { access_code } = await initializeSubscription({
      email: viewer.user.email,
      userId: viewer.user.id,
      planCode: plan.plan_code,
      amount: plan.amount,
      callbackUrl: `${publicEnv.siteUrl}/pricing?paid=1`,
    });
    return NextResponse.json({ accessCode: access_code });
  } catch (err) {
    console.error("[paystack] initialize failed", err);
    return NextResponse.json({ error: "Couldn't start checkout. Please try again." }, { status: 502 });
  }
}
