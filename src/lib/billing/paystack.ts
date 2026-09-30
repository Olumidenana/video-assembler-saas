import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
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

export function planCode(): string {
  const code = process.env.PAYSTACK_PLAN_CODE?.trim();
  if (!code) throw new PaystackError("PAYSTACK_PLAN_CODE is not configured");
  return code;
}

export const paystackConfigured = () =>
  Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PLAN_CODE && process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY);

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

/** The Pro plan as configured in the Paystack dashboard (cached for 10 minutes). */
export async function getPlan(): Promise<PaystackPlan | null> {
  if (!paystackConfigured()) return null;
  try {
    return await call<PaystackPlan>(`/plan/${encodeURIComponent(planCode())}`, { next: { revalidate: 600 } });
  } catch (err) {
    console.error("[paystack] could not load plan", err);
    return null;
  }
}

export function initializeSubscription(input: { email: string; userId: string; amount: number; callbackUrl: string }) {
  return call<{ access_code: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amount,
      plan: planCode(),
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
