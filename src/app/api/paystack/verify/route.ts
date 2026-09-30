import { NextResponse, type NextRequest } from "next/server";
import { activateFromTransaction, getViewer, syncFromPaystack } from "@/lib/billing/account";
import { verifyTransaction } from "@/lib/billing/paystack";
import { transactionUserId } from "@/lib/billing/status";

/**
 * Called by the checkout popup right after payment so Pro unlocks immediately.
 * The browser's word is never trusted: we re-fetch the transaction from
 * Paystack and check it belongs to this user and this plan.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const { reference } = (await request.json().catch(() => ({}))) as { reference?: unknown };
  if (typeof reference !== "string" || !/^[\w.=-]{1,100}$/.test(reference)) {
    return NextResponse.json({ error: "Invalid reference." }, { status: 400 });
  }

  try {
    const tx = await verifyTransaction(reference);
    if (transactionUserId(tx) !== viewer.user.id) {
      return NextResponse.json({ error: "This payment belongs to a different account." }, { status: 403 });
    }
    await activateFromTransaction(tx, viewer.user.id);
    // The subscription may already exist; pick up its real renewal date if so.
    await syncFromPaystack(tx.customer.customer_code).catch(() => {});
    return NextResponse.json({ pro: true });
  } catch (err) {
    console.error("[paystack] verify failed", err);
    return NextResponse.json(
      { error: "We couldn't confirm your payment yet. If you were charged, Pro will unlock within a few minutes." },
      { status: 502 },
    );
  }
}
