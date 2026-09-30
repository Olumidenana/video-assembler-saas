import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { getManageLink } from "@/lib/billing/paystack";

/** Sends the user to Paystack's hosted page to update their card or cancel. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  const code = viewer.subscription?.paystack_subscription_code;
  const back = (error: string) => NextResponse.redirect(new URL(`/account?error=${error}`, request.nextUrl.origin), { status: 303 });
  if (!viewer.user) return NextResponse.redirect(new URL("/login?next=/account", request.nextUrl.origin), { status: 303 });
  if (!code) return back("no-subscription");

  try {
    return NextResponse.redirect(await getManageLink(code), { status: 303 });
  } catch (err) {
    console.error("[paystack] manage link failed", err);
    return back("manage");
  }
}
