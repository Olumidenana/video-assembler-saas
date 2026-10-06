import "server-only";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { supabaseConfigured } from "@/lib/env";
import type { PlanId } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  disableSubscription,
  fetchCustomer,
  getPlan,
  getPlans,
  tierForPlanCode,
  type PaystackTransaction,
} from "./paystack";
import {
  intervalDays,
  isComplimentary,
  pickSubscription,
  planForSubscription,
  type SubscriptionRow,
  transactionPlanCode,
} from "./status";

export interface Viewer {
  user: { id: string; email: string; name: string | null } | null;
  subscription: SubscriptionRow | null;
  plan: PlanId;
  /** Studio granted without payment (COMPLIMENTARY_STUDIO_EMAILS). */
  complimentary?: boolean;
}

const SIGNED_OUT: Viewer = { user: null, subscription: null, plan: "free" };

/** The signed-in user and their plan. Deduplicated per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!supabaseConfigured) return SIGNED_OUT;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return SIGNED_OUT;

    // Row level security limits this to the user's own row.
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", data.user.id)
      .maybeSingle<SubscriptionRow>();

    const meta = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
    // Only a verified sign-in email counts (Google always verifies it).
    const complimentary = Boolean(data.user.email_confirmed_at) && isComplimentary(data.user.email);
    return {
      user: { id: data.user.id, email: data.user.email ?? "", name: meta?.full_name ?? meta?.name ?? null },
      subscription: subscription ?? null,
      plan: complimentary ? "studio" : planForSubscription(subscription ?? null, tierForPlanCode),
      complimentary,
    };
  } catch (err) {
    unstable_rethrow(err); // Next.js uses errors to detect dynamic pages; those aren't failures.
    console.error("[account] could not load viewer", err);
    return SIGNED_OUT;
  }
});

/**
 * Grants the paid tier right after a verified first payment, before Paystack
 * has created the subscription. `syncFromPaystack` replaces the provisional
 * period end with the real renewal date once the subscription exists.
 */
export async function activateFromTransaction(tx: PaystackTransaction, userId: string): Promise<void> {
  if (tx.status !== "success") throw new Error("Payment was not successful");
  const code = transactionPlanCode(tx);
  const tier = tierForPlanCode(code);
  if (!code || !tier) throw new Error("Payment is not for one of our plans");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<SubscriptionRow>();

  // Upgrading from Pro to Studio: stop the old subscription so they aren't charged twice.
  const previousTier = tierForPlanCode(existing?.plan_code);
  if (
    previousTier &&
    previousTier !== tier &&
    existing?.paystack_subscription_code &&
    existing.paystack_email_token
  ) {
    await disableSubscription(existing.paystack_subscription_code, existing.paystack_email_token).catch((err) =>
      console.error("[paystack] could not stop previous subscription", err),
    );
  }

  const plan = await getPlan(tier);
  const paidAt = tx.paid_at ? new Date(tx.paid_at).getTime() : Date.now();
  const provisionalEnd = paidAt + intervalDays(plan?.interval ?? "monthly") * 24 * 60 * 60 * 1000;
  const sameTier = previousTier === tier;
  const existingEnd = sameTier && existing?.current_period_end ? new Date(existing.current_period_end).getTime() : 0;

  const { error } = await admin.from("subscriptions").upsert({
    user_id: userId,
    email: tx.customer.email,
    status: "active",
    plan_code: code,
    paystack_customer_code: tx.customer.customer_code,
    paystack_subscription_code: sameTier ? (existing?.paystack_subscription_code ?? null) : null,
    paystack_email_token: sameTier ? (existing?.paystack_email_token ?? null) : null,
    current_period_end: new Date(Math.max(provisionalEnd, existingEnd)).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * Makes our row match Paystack. Webhooks only tell us *that* something changed;
 * we always re-read the customer's subscriptions from Paystack, so events that
 * arrive late or out of order can't leave us in a wrong state.
 */
export async function syncFromPaystack(customerCode: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("subscriptions")
    .select("*")
    .eq("paystack_customer_code", customerCode)
    .maybeSingle<SubscriptionRow>();
  if (!row) return; // Not one of ours (yet); the first payment links the customer to a user.

  const [customer, plans] = await Promise.all([fetchCustomer(customerCode), getPlans()]);
  if (plans.length === 0) throw new Error("No plans configured");
  const best = pickSubscription(customer.subscriptions ?? [], plans);
  if (!best) return; // Subscription not created yet; keep the provisional state.

  const samePlan = best.plan.plan_code === row.plan_code;
  const { error } = await admin
    .from("subscriptions")
    .update({
      status: best.subscription.status,
      plan_code: best.plan.plan_code,
      paystack_subscription_code: best.subscription.subscription_code,
      paystack_email_token: best.subscription.email_token,
      // "non-renewing" subscriptions have no next payment; keep access until the paid period ends.
      current_period_end: best.subscription.next_payment_date ?? (samePlan ? row.current_period_end : null),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id);
  if (error) throw error;
}
