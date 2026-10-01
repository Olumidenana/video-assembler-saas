import { NextResponse } from "next/server";
import { diagnose } from "@/lib/billing/paystack";

/**
 * Open /api/paystack/status to see why prices or checkout aren't showing.
 * Reports which settings exist and whether Paystack recognises each plan
 * code; never returns key values.
 */
export async function GET() {
  return NextResponse.json(await diagnose(), { headers: { "Cache-Control": "no-store" } });
}
