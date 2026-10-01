/**
 * Simulates the full subscription lifecycle against a fake Paystack API and an
 * in-memory "subscriptions" table: first payment, webhook sync, cancellation
 * and expiry, plus the webhook's signature check.
 */
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaystackTransaction } from "./paystack";
import { isPaidSubscription, type PaystackSubscription, type SubscriptionRow } from "./status";

const SECRET = "sk_test_flow";
vi.stubEnv("PAYSTACK_SECRET_KEY", SECRET);
vi.stubEnv("PAYSTACK_PLAN_CODE", "PLN_pro");
vi.stubEnv("PAYSTACK_STUDIO_PLAN_CODE", "PLN_studio");
vi.stubEnv("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY", "pk_test_flow");

// --- In-memory stand-in for the Supabase admin client ---------------------
const table = new Map<string, SubscriptionRow>();
function query() {
  let filter: [keyof SubscriptionRow, unknown] | null = null;
  const find = () => [...table.values()].find((r) => filter && r[filter[0]] === filter[1]) ?? null;
  const api = {
    select: () => api,
    eq: (col: keyof SubscriptionRow, val: unknown) => {
      filter = [col, val];
      return api;
    },
    maybeSingle: async () => ({ data: find(), error: null }),
    upsert: async (row: SubscriptionRow) => {
      table.set(row.user_id, { ...table.get(row.user_id), ...row });
      return { error: null };
    },
    update: (patch: Partial<SubscriptionRow>) => ({
      eq: async (col: keyof SubscriptionRow, val: unknown) => {
        filter = [col, val];
        const existing = find();
        if (existing) table.set(existing.user_id, { ...existing, ...patch });
        return { error: null };
      },
    }),
  };
  return api;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query() }) }));

// --- Fake Paystack API -----------------------------------------------------
let customerSubs: PaystackSubscription[] = [];
const disabled: unknown[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const ok = (data: unknown) => new Response(JSON.stringify({ status: true, data }), { status: 200 });
    if (path === "/plan/PLN_pro") {
      return ok({ id: 7, name: "Pro", plan_code: "PLN_pro", amount: 500000, interval: "monthly", currency: "NGN" });
    }
    if (path === "/plan/PLN_studio") {
      return ok({ id: 9, name: "Studio", plan_code: "PLN_studio", amount: 500000, interval: "monthly", currency: "NGN" });
    }
    if (path === "/subscription/disable") {
      disabled.push(JSON.parse(String(init?.body)));
      return ok({});
    }
    if (path === "/customer/CUS_1") {
      return ok({ customer_code: "CUS_1", email: "ada@example.com", subscriptions: customerSubs });
    }
    return new Response(JSON.stringify({ status: false, message: "not found" }), { status: 404 });
  }),
);

const { activateFromTransaction, syncFromPaystack } = await import("./account");
const { POST: webhook } = await import("@/app/api/paystack/webhook/route");

const tx = (over: Partial<PaystackTransaction> = {}): PaystackTransaction => ({
  status: "success",
  reference: "ref_1",
  amount: 500000,
  paid_at: new Date().toISOString(),
  metadata: { user_id: "user-1" },
  plan: "PLN_pro",
  customer: { customer_code: "CUS_1", email: "ada@example.com" },
  ...over,
});

function signedWebhook(event: unknown, signature?: string) {
  const body = JSON.stringify(event);
  return new NextRequest("http://localhost/api/paystack/webhook", {
    method: "POST",
    body,
    headers: { "x-paystack-signature": signature ?? createHmac("sha512", SECRET).update(body).digest("hex") },
  });
}

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

beforeEach(() => {
  table.clear();
  customerSubs = [];
  disabled.length = 0;
});

describe("subscription lifecycle", () => {
  it("unlocks Pro on first payment, then adopts Paystack's renewal date", async () => {
    await activateFromTransaction(tx(), "user-1");
    const provisional = table.get("user-1")!;
    expect(provisional.status).toBe("active");
    expect(isPaidSubscription(provisional)).toBe(true);
    expect(new Date(provisional.current_period_end!).getTime()).toBeGreaterThan(Date.now() + 30 * DAY);

    // Subscription not created yet: sync must not downgrade the provisional state.
    await syncFromPaystack("CUS_1");
    expect(table.get("user-1")).toEqual(provisional);

    customerSubs = [
      { status: "active", subscription_code: "SUB_1", email_token: "tok", next_payment_date: inDays(30), plan: 7 },
    ];
    await syncFromPaystack("CUS_1");
    expect(table.get("user-1")).toMatchObject({ paystack_subscription_code: "SUB_1", paystack_email_token: "tok" });
  });

  it("keeps Pro until the period ends after cancelling, then removes it", async () => {
    await activateFromTransaction(tx(), "user-1");
    customerSubs = [{ status: "active", subscription_code: "SUB_1", email_token: "t", next_payment_date: inDays(20), plan: 7 }];
    await syncFromPaystack("CUS_1");
    const paidUntil = table.get("user-1")!.current_period_end;

    customerSubs = [{ status: "non-renewing", subscription_code: "SUB_1", email_token: "t", next_payment_date: null, plan: 7 }];
    await syncFromPaystack("CUS_1");
    const cancelled = table.get("user-1")!;
    expect(cancelled.status).toBe("non-renewing");
    expect(cancelled.current_period_end).toBe(paidUntil);
    expect(isPaidSubscription(cancelled)).toBe(true);

    customerSubs = [{ status: "complete", subscription_code: "SUB_1", email_token: "t", next_payment_date: null, plan: 7 }];
    await syncFromPaystack("CUS_1");
    expect(isPaidSubscription(table.get("user-1")!)).toBe(false);
  });

  it("upgrades Pro to Studio and stops the old Pro subscription", async () => {
    await activateFromTransaction(tx(), "user-1");
    customerSubs = [{ status: "active", subscription_code: "SUB_pro", email_token: "tok_pro", next_payment_date: inDays(20), plan: 7 }];
    await syncFromPaystack("CUS_1");

    await activateFromTransaction(tx({ reference: "ref_2", plan: "PLN_studio" }), "user-1");
    expect(disabled).toEqual([{ code: "SUB_pro", token: "tok_pro" }]);
    expect(table.get("user-1")).toMatchObject({ plan_code: "PLN_studio", status: "active" });

    // Paystack now lists both; the Studio subscription wins.
    customerSubs = [
      { status: "non-renewing", subscription_code: "SUB_pro", email_token: "tok_pro", next_payment_date: null, plan: 7 },
      { status: "active", subscription_code: "SUB_studio", email_token: "tok_s", next_payment_date: inDays(30), plan: 9 },
    ];
    await syncFromPaystack("CUS_1");
    expect(table.get("user-1")).toMatchObject({ plan_code: "PLN_studio", paystack_subscription_code: "SUB_studio" });
  });

  it("rejects payments that aren't successful or aren't for one of our plans", async () => {
    await expect(activateFromTransaction(tx({ status: "failed" }), "user-1")).rejects.toThrow();
    await expect(activateFromTransaction(tx({ plan: "PLN_other" }), "user-1")).rejects.toThrow();
    expect(table.size).toBe(0);
  });
});

describe("webhook route", () => {
  it("rejects requests without a valid Paystack signature", async () => {
    const res = await webhook(signedWebhook({ event: "charge.success", data: tx() }, "forged"));
    expect(res.status).toBe(401);
    expect(table.size).toBe(0);
  });

  it("activates Pro from charge.success even if the buyer closed the tab", async () => {
    const res = await webhook(signedWebhook({ event: "charge.success", data: tx() }));
    expect(res.status).toBe(200);
    expect(isPaidSubscription(table.get("user-1") ?? null)).toBe(true);
  });

  it("ignores charges for other products and unknown customers", async () => {
    await webhook(signedWebhook({ event: "charge.success", data: tx({ plan: {}, metadata: {} }) }));
    await webhook(signedWebhook({ event: "subscription.disable", data: { customer: { customer_code: "CUS_404" } } }));
    expect(table.size).toBe(0);
  });

  it("applies a cancellation event to a known customer", async () => {
    await activateFromTransaction(tx(), "user-1");
    customerSubs = [{ status: "cancelled", subscription_code: "SUB_1", email_token: "t", next_payment_date: null, plan: 7 }];
    const res = await webhook(signedWebhook({ event: "subscription.disable", data: { customer: { customer_code: "CUS_1" } } }));
    expect(res.status).toBe(200);
    expect(table.get("user-1")?.status).toBe("cancelled");
  });
});
