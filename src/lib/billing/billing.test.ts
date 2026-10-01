import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import { isValidSignature } from "./paystack";
import {
  isPaidSubscription,
  planForSubscription,
  pickSubscription,
  safeNextPath,
  type SubscriptionRow,
  transactionPlanCode,
  transactionUserId,
} from "./status";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-30T12:00:00Z");

const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  user_id: "u1",
  email: "a@b.c",
  status: "active",
  plan_code: "PLN_x",
  paystack_customer_code: "CUS_x",
  paystack_subscription_code: "SUB_x",
  paystack_email_token: "tok",
  current_period_end: new Date(NOW + 10 * DAY).toISOString(),
  ...over,
});

describe("isPaidSubscription", () => {
  it("grants Pro to active, non-renewing and retrying subscriptions within the period", () => {
    for (const status of ["active", "non-renewing", "attention"]) {
      expect(isPaidSubscription(row({ status }), NOW)).toBe(true);
    }
  });

  it("denies cancelled, completed and missing subscriptions", () => {
    expect(isPaidSubscription(null, NOW)).toBe(false);
    expect(isPaidSubscription(row({ status: "cancelled" }), NOW)).toBe(false);
    expect(isPaidSubscription(row({ status: "complete" }), NOW)).toBe(false);
    expect(isPaidSubscription(row({ current_period_end: null }), NOW)).toBe(false);
  });

  it("keeps a one-day grace period after the period ends", () => {
    const ended = (ms: number) => row({ current_period_end: new Date(NOW - ms).toISOString() });
    expect(isPaidSubscription(ended(12 * 60 * 60 * 1000), NOW)).toBe(true);
    expect(isPaidSubscription(ended(2 * DAY), NOW)).toBe(false);
  });
});

describe("planForSubscription", () => {
  const tierOf = (code: string | null) => (code === "PLN_s" ? "studio" : code === "PLN_x" ? "pro" : null);
  it("maps an active subscription to its tier, and anything else to free", () => {
    expect(planForSubscription(row({ plan_code: "PLN_s" }), tierOf, NOW)).toBe("studio");
    expect(planForSubscription(row(), tierOf, NOW)).toBe("pro");
    expect(planForSubscription(row({ status: "cancelled", plan_code: "PLN_s" }), tierOf, NOW)).toBe("free");
    expect(planForSubscription(null, tierOf, NOW)).toBe("free");
  });
});

describe("pickSubscription", () => {
  const plans = [
    { id: 7, plan_code: "PLN_x", tier: "pro" as const },
    { id: 8, plan_code: "PLN_s", tier: "studio" as const },
  ];
  const sub = (status: string, planRef: number | { plan_code: string }) => ({
    status,
    subscription_code: `SUB_${status}`,
    email_token: "t",
    next_payment_date: null,
    plan: planRef,
  });

  it("ignores other plans and prefers the most permissive status", () => {
    const picked = pickSubscription([sub("cancelled", 7), sub("active", 99), sub("non-renewing", { plan_code: "PLN_x" })], plans);
    expect(picked?.subscription.subscription_code).toBe("SUB_non-renewing");
    expect(picked?.plan.tier).toBe("pro");
  });

  it("prefers Studio over Pro when both are active", () => {
    const picked = pickSubscription([{ ...sub("active", 7), subscription_code: "SUB_pro" }, { ...sub("active", 8), subscription_code: "SUB_studio" }], plans);
    expect(picked?.subscription.subscription_code).toBe("SUB_studio");
    expect(picked?.plan.tier).toBe("studio");
  });

  it("returns null when the customer has no subscription to our plans", () => {
    expect(pickSubscription([sub("active", 99)], plans)).toBeNull();
  });
});

describe("transaction helpers", () => {
  it("reads the plan code from string or object forms", () => {
    expect(transactionPlanCode({ plan: "PLN_x" })).toBe("PLN_x");
    expect(transactionPlanCode({ plan: { plan_code: "PLN_y" } })).toBe("PLN_y");
    expect(transactionPlanCode({ plan: {}, plan_object: { plan_code: "PLN_z" } })).toBe("PLN_z");
    expect(transactionPlanCode({ plan: null })).toBeNull();
  });

  it("reads the user id from object or JSON-string metadata", () => {
    expect(transactionUserId({ metadata: { user_id: "u1" } })).toBe("u1");
    expect(transactionUserId({ metadata: '{"user_id":"u2"}' })).toBe("u2");
    expect(transactionUserId({ metadata: "" })).toBeNull();
    expect(transactionUserId({ metadata: { user_id: 5 } })).toBeNull();
  });
});

describe("isValidSignature", () => {
  const key = "sk_test_abc";
  const body = JSON.stringify({ event: "charge.success", data: { id: 1 } });
  const sign = (b: string) => createHmac("sha512", key).update(b).digest("hex");

  it("accepts Paystack's HMAC-SHA512 signature", () => {
    expect(isValidSignature(body, sign(body), key)).toBe(true);
  });

  it("rejects missing, wrong or tampered signatures", () => {
    expect(isValidSignature(body, null, key)).toBe(false);
    expect(isValidSignature(body, "deadbeef", key)).toBe(false);
    expect(isValidSignature(body + " ", sign(body), key)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("only allows same-site paths", () => {
    expect(safeNextPath("/pricing")).toBe("/pricing");
    expect(safeNextPath("//evil.com")).toBe("/editor");
    expect(safeNextPath("https://evil.com")).toBe("/editor");
    expect(safeNextPath("/\\evil.com")).toBe("/editor");
    expect(safeNextPath(null)).toBe("/editor");
  });
});

describe("formatMoney", () => {
  it("formats kobo as naira", () => {
    expect(formatMoney(500000, "NGN")).toMatch(/5,000$/);
    expect(formatMoney(250050, "NGN")).toMatch(/2,500\.50$/);
  });
});
