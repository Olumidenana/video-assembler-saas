import { NextResponse, type NextRequest } from "next/server";
import { activateFromTransaction, syncFromPaystack } from "@/lib/billing/account";
import { isValidSignature, planCode, type PaystackTransaction } from "@/lib/billing/paystack";
import { transactionPlanCode, transactionUserId } from "@/lib/billing/status";

const SUBSCRIPTION_EVENTS = new Set([
  "charge.success",
  "subscription.create",
  "subscription.not_renew",
  "subscription.disable",
  "invoice.create",
  "invoice.update",
  "invoice.payment_failed",
]);

/**
 * Paystack → us. Set this URL in Paystack: Settings → API Keys & Webhooks →
 * Webhook URL. Returning non-2xx makes Paystack retry, so we only do that when
 * something on our side failed.
 */
export async function POST(request: NextRequest) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return NextResponse.json({ error: "Payments not configured" }, { status: 503 });
  }
  const raw = await request.text();
  if (!isValidSignature(raw, request.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as { event: string; data: PaystackTransaction & { customer?: { customer_code?: string } } };
  if (!SUBSCRIPTION_EVENTS.has(event.event)) return NextResponse.json({ ok: true });

  const customerCode = event.data?.customer?.customer_code;
  if (!customerCode) return NextResponse.json({ ok: true });

  try {
    // First payment: link the Paystack customer to our user, even if the buyer
    // closed the tab before the popup could call /api/paystack/verify.
    const userId = transactionUserId(event.data);
    if (event.event === "charge.success" && userId && transactionPlanCode(event.data) === planCode()) {
      await activateFromTransaction(event.data, userId);
    }
    await syncFromPaystack(customerCode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[paystack] webhook ${event.event} failed`, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
