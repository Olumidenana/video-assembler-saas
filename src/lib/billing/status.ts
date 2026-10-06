import { PLAN_RANK, type PaidPlanId, type PlanId } from "@/lib/plans";

/** Pure subscription logic, shared by server code and unit tests. */

export interface SubscriptionRow {
  user_id: string;
  email: string | null;
  status: string;
  plan_code: string | null;
  paystack_customer_code: string | null;
  paystack_subscription_code: string | null;
  paystack_email_token: string | null;
  current_period_end: string | null;
  updated_at?: string;
}

/**
 * Paystack subscription statuses that still grant access until the period ends:
 * "non-renewing" = cancelled but paid up; "attention" = a renewal failed and
 * Paystack is retrying the card.
 */
const PRO_STATUSES = new Set(["active", "non-renewing", "attention"]);

/** Renewal webhooks can land a little after the period ends; don't lock people out meanwhile. */
const GRACE_MS = 24 * 60 * 60 * 1000;

export function isPaidSubscription(row: SubscriptionRow | null, now = Date.now()): boolean {
  if (!row || !PRO_STATUSES.has(row.status) || !row.current_period_end) return false;
  return new Date(row.current_period_end).getTime() + GRACE_MS > now;
}

const INTERVAL_DAYS: Record<string, number> = {
  hourly: 1,
  daily: 1,
  weekly: 7,
  monthly: 31,
  quarterly: 92,
  biannually: 183,
  annually: 366,
};

export function intervalDays(interval: string): number {
  return INTERVAL_DAYS[interval] ?? 31;
}

export interface PaystackPlanRef {
  id: number;
  plan_code: string;
}

/** The tier a subscription row grants, given a lookup from plan code to tier. */
export function planForSubscription(
  row: SubscriptionRow | null,
  tierOf: (planCode: string | null) => PaidPlanId | null,
  now = Date.now(),
): PlanId {
  if (!isPaidSubscription(row, now)) return "free";
  return tierOf(row!.plan_code) ?? "pro";
}

export interface PaystackSubscription {
  status: string;
  subscription_code: string;
  email_token: string;
  next_payment_date: string | null;
  /** A plan id in some responses, an expanded plan object in others. */
  plan: number | { id?: number; plan_code?: string } | null;
}

const STATUS_RANK = ["active", "attention", "non-renewing", "complete", "cancelled"];

/**
 * The customer's best subscription to one of our plans: the most access-granting
 * status first, then the higher tier (Studio over Pro).
 */
export function pickSubscription(
  subs: PaystackSubscription[],
  plans: (PaystackPlanRef & { tier: PaidPlanId })[],
): { subscription: PaystackSubscription; plan: PaystackPlanRef & { tier: PaidPlanId } } | null {
  const matches = subs.flatMap((s) => {
    const plan = plans.find((p) =>
      typeof s.plan === "number" ? s.plan === p.id : s.plan?.plan_code === p.plan_code || s.plan?.id === p.id,
    );
    return plan ? [{ subscription: s, plan }] : [];
  });
  const statusRank = (s: PaystackSubscription) => {
    const i = STATUS_RANK.indexOf(s.status);
    return i === -1 ? STATUS_RANK.length : i;
  };
  return (
    matches.sort(
      (a, b) =>
        statusRank(a.subscription) - statusRank(b.subscription) || PLAN_RANK[b.plan.tier] - PLAN_RANK[a.plan.tier],
    )[0] ?? null
  );
}

/** The plan code on a transaction; Paystack returns it as a string or an object depending on the endpoint. */
export function transactionPlanCode(tx: { plan?: unknown; plan_object?: { plan_code?: string } }): string | null {
  if (typeof tx.plan === "string" && tx.plan) return tx.plan;
  if (tx.plan && typeof tx.plan === "object" && "plan_code" in tx.plan) return String(tx.plan.plan_code);
  return tx.plan_object?.plan_code ?? null;
}

/** Paystack sends metadata as an object or as a JSON string. */
export function transactionUserId(tx: { metadata?: unknown }): string | null {
  let meta = tx.metadata;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch {
      return null;
    }
  }
  const id = meta && typeof meta === "object" && "user_id" in meta ? (meta as { user_id: unknown }).user_id : null;
  return typeof id === "string" && id ? id : null;
}

/** Only allow redirects to paths on this site (blocks "//evil.com" and "https://..."). */
export function safeNextPath(next: string | null | undefined, fallback = "/editor"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/**
 * Emails given Studio for free (the owner, testers, partners), from the
 * COMPLIMENTARY_STUDIO_EMAILS environment variable: comma-separated,
 * case-insensitive. Server-only, so the list is never public.
 */
export function isComplimentary(email: string | null | undefined, list = process.env.COMPLIMENTARY_STUDIO_EMAILS): boolean {
  if (!email || !list) return false;
  const wanted = email.trim().toLowerCase();
  return list.split(",").some((e) => e.trim().toLowerCase() === wanted);
}
