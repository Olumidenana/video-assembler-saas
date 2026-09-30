import "server-only";
import { cache } from "react";
import { supabaseConfigured } from "@/lib/env";
import type { PlanId } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchCustomer, getPlan, planCode, type PaystackTransaction } from "./paystack";
import {
  intervalDays,
  isProSubscription,
  pickSubscription,
  type SubscriptionRow,
  transactionPlanCode,
} from "./status";

export interface Viewer {
  user: { id: string; email: string; name: string | null } | null;
  subscription: SubscriptionRow | null;
  plan: PlanId;
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
    return {
      user: { id: data.user.id, email: data.user.email ?? "", name: meta?.full_name ?? meta?.name ?? null },
      subscription: subscription ?? null,
      plan: isProSubscription(subscription ?? null) ? "pro" : "free",
    };
  } catch (err) {
    console.error("[account] could not load viewer", err);
    return SIGNED_OUT;
  }
});

/**
 * Grants Pro right after a verified first payment, before Paystack has created
 * the subscription. `syncFromPaystack` replaces the provisional period end with
 * the real renewal date once the subscription exists.
 */
export async function activateFromTransaction(tx: PaystackTransaction, userId: string): Promise<void> {
  if (tx.status !== "success") throw new Error("Payment was not successful");
  if (transactionPlanCode(tx) !== planCode()) throw new Error("Payment is not for the Pro plan");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<SubscriptionRow>();

  const plan = await getPlan();
  const paidAt = tx.paid_at ? new Date(tx.paid_at).getTime() : Date.now();
  const provisionalEnd = paidAt + intervalDays(plan?.interval ?? "monthly") * 24 * 60 * 60 * 1000;
  const existingEnd = existing?.current_period_end ? new Date(existing.current_period_end).getTime() : 0;

  const { error } = await admin.from("subscriptions").upsert({
    user_id: userId,
    email: tx.customer.email,
    status: "active",
    plan_code: planCode(),
    paystack_customer_code: tx.customer.customer_code,
    paystack_subscription_code: existing?.paystack_subscription_code ?? null,
    paystack_email_token: existing?.paystack_email_token ?? null,
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

  const [customer, plan] = await Promise.all([fetchCustomer(customerCode), getPlan()]);
  if (!plan) throw new Error("Plan not configured");
  const sub = pickSubscription(customer.subscriptions ?? [], plan);
  if (!sub) return; // Subscription not created yet; keep the provisional state.

  const { error } = await admin
    .from("subscriptions")
    .update({
      status: sub.status,
      paystack_subscription_code: sub.subscription_code,
      paystack_email_token: sub.email_token,
      // "non-renewing" subscriptions have no next payment; keep access until the paid period ends.
      current_period_end: sub.next_payment_date ?? row.current_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id);
  if (error) throw error;
}
