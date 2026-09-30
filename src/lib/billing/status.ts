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

export function isProSubscription(row: SubscriptionRow | null, now = Date.now()): boolean {
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

export interface PaystackSubscription {
  status: string;
  subscription_code: string;
  email_token: string;
  next_payment_date: string | null;
  /** A plan id in some responses, an expanded plan object in others. */
  plan: number | { id?: number; plan_code?: string } | null;
}

const STATUS_RANK = ["active", "attention", "non-renewing", "complete", "cancelled"];

/** The customer's subscription to our plan, preferring the one that grants the most access. */
export function pickSubscription(subs: PaystackSubscription[], plan: PaystackPlanRef): PaystackSubscription | null {
  const ours = subs.filter((s) =>
    typeof s.plan === "number" ? s.plan === plan.id : s.plan?.plan_code === plan.plan_code || s.plan?.id === plan.id,
  );
  const rank = (s: PaystackSubscription) => {
    const i = STATUS_RANK.indexOf(s.status);
    return i === -1 ? STATUS_RANK.length : i;
  };
  return ours.sort((a, b) => rank(a) - rank(b))[0] ?? null;
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
