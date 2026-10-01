import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { PAID_PLANS, type PaidPlanId } from "@/lib/plans";
import type { PaystackSubscription } from "./status";

const API = "https://api.paystack.co";

export class PaystackError extends Error {}

export interface PaystackPlan {
  id: number;
  name: string;
  plan_code: string;
  /** In the currency's minor unit (kobo for NGN). */
  amount: number;
  interval: string;
  currency: string;
}

export interface PaystackTransaction {
  status: string;
  reference: string;
  amount: number;
  paid_at: string | null;
  metadata: unknown;
  plan?: unknown;
  plan_object?: { plan_code?: string };
  customer: { customer_code: string; email: string };
}

export interface PaystackCustomer {
  customer_code: string;
  email: string;
  subscriptions: PaystackSubscription[];
}

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new PaystackError("PAYSTACK_SECRET_KEY is not configured");
  return key;
}

/** Paystack plan codes per tier (Pro: PAYSTACK_PLAN_CODE, Studio: PAYSTACK_STUDIO_PLAN_CODE). */
export function planCodes(): Partial<Record<PaidPlanId, string>> {
  const pro = process.env.PAYSTACK_PLAN_CODE?.trim();
  const studio = process.env.PAYSTACK_STUDIO_PLAN_CODE?.trim();
  return { ...(pro ? { pro } : {}), ...(studio ? { studio } : {}) };
}

export function tierForPlanCode(code: string | null | undefined): PaidPlanId | null {
  if (!code) return null;
  const codes = planCodes();
  return PAID_PLANS.find((tier) => codes[tier] === code) ?? null;
}

export const paystackConfigured = () =>
  Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY && Object.keys(planCodes()).length);

async function call<T>(path: string, init: RequestInit & { next?: { revalidate: number } } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...init.headers },
    // Paystack answers in well under a second; don't let a hang eat the function's time budget.
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !json?.status) {
    throw new PaystackError(json?.message ?? `Paystack request failed (${res.status})`);
  }
  return json.data as T;
}

/** A tier's plan as configured in the Paystack dashboard (cached for 10 minutes). */
export async function getPlan(tier: PaidPlanId): Promise<PaystackPlan | null> {
  const code = planCodes()[tier];
  if (!paystackConfigured() || !code) return null;
  try {
    return await call<PaystackPlan>(`/plan/${encodeURIComponent(code)}`, { next: { revalidate: 600 } });
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[paystack] could not load ${tier} plan`, err);
    return null;
  }
}

export type KeyState = "missing" | "test" | "live" | "invalid";

const keyState = (value: string | undefined, prefix: "sk" | "pk"): KeyState => {
  const key = value?.trim();
  if (!key) return "missing";
  if (key.startsWith(`${prefix}_test_`)) return "test";
  if (key.startsWith(`${prefix}_live_`)) return "live";
  return "invalid";
};

/**
 * Setup check for /api/paystack/status: which settings are present (never
 * their values) and what Paystack says about each plan code. Uncached.
 */
export async function diagnose() {
  const secret = keyState(process.env.PAYSTACK_SECRET_KEY, "sk");
  const publicKey = keyState(process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY, "pk");
  const env = { pro: "PAYSTACK_PLAN_CODE", studio: "PAYSTACK_STUDIO_PLAN_CODE" } as const;
  const plans = Object.fromEntries(
    await Promise.all(
      PAID_PLANS.map(async (tier) => {
        const code = planCodes()[tier];
        let status: string;
        if (!code) status = `missing: set ${env[tier]} in Vercel, then redeploy`;
        else if (!/^PLN_[a-z0-9]+$/i.test(code)) status = `invalid: ${env[tier]} should look like PLN_xxxxxxxx (copy the Plan Code, not the name or link)`;
        else if (secret === "missing" || secret === "invalid") status = "not checked: fix PAYSTACK_SECRET_KEY first";
        else {
          try {
            const plan = await call<PaystackPlan>(`/plan/${encodeURIComponent(code)}`, { cache: "no-store" });
            status = `ok: "${plan.name}", ${plan.currency} ${plan.amount / 100} ${plan.interval}`;
          } catch (err) {
            status = `error from Paystack: ${err instanceof Error ? err.message : "unknown"} (is the plan in ${secret} mode?)`;
          }
        }
        return [tier, status] as const;
      }),
    ),
  );
  const problems = [
    secret === "missing" && "PAYSTACK_SECRET_KEY is missing",
    secret === "invalid" && "PAYSTACK_SECRET_KEY should start with sk_test_ or sk_live_",
    publicKey === "missing" && "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is missing",
    publicKey === "invalid" && "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY should start with pk_test_ or pk_live_",
    secret !== publicKey && ["test", "live"].includes(secret) && ["test", "live"].includes(publicKey) &&
      `keys are from different modes (secret: ${secret}, public: ${publicKey})`,
    ...Object.entries(plans).filter(([, v]) => !v.startsWith("ok")).map(([tier, v]) => `${tier} plan ${v}`),
  ].filter((p): p is string => Boolean(p));
  return { ready: problems.length === 0, secretKey: secret, publicKey, plans, problems };
}

/** Every configured paid plan, tagged with its tier. */
export async function getPlans(): Promise<(PaystackPlan & { tier: PaidPlanId })[]> {
  const plans = await Promise.all(PAID_PLANS.map(async (tier) => ({ tier, plan: await getPlan(tier) })));
  return plans.flatMap(({ tier, plan }) => (plan ? [{ ...plan, tier }] : []));
}

export function initializeSubscription(input: {
  email: string;
  userId: string;
  planCode: string;
  amount: number;
  callbackUrl: string;
}) {
  return call<{ access_code: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amount,
      plan: input.planCode,
      // Only cards can be charged again automatically for renewals.
      channels: ["card"],
      callback_url: input.callbackUrl,
      metadata: { user_id: input.userId },
    }),
  });
}

export function verifyTransaction(reference: string) {
  return call<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export function fetchCustomer(customerCode: string) {
  return call<PaystackCustomer>(`/customer/${encodeURIComponent(customerCode)}`);
}

/** Stops a subscription from renewing (used when a Pro subscriber upgrades to Studio). */
export async function disableSubscription(code: string, emailToken: string): Promise<void> {
  await call("/subscription/disable", { method: "POST", body: JSON.stringify({ code, token: emailToken }) });
}

/** A Paystack-hosted page where the customer can update their card or cancel. */
export async function getManageLink(subscriptionCode: string): Promise<string> {
  const data = await call<{ link: string }>(`/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`);
  return data.link;
}

/** Verifies the `x-paystack-signature` header: HMAC-SHA512 of the raw body with the secret key. */
export function isValidSignature(rawBody: string, signature: string | null, key = secretKey()): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
