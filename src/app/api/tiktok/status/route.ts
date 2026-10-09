import { NextResponse } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { getConnection, tiktokConfigured } from "@/lib/social/tiktok";

/** Whether TikTok posting is configured on this site, permitted for the user's plan, and connected. */
export async function GET() {
  const viewer = await getViewer();
  const allowed = PLAN_LIMITS[viewer.plan].directPost;
  if (!tiktokConfigured() || !viewer.user || !allowed) {
    return NextResponse.json({ configured: tiktokConfigured(), allowed, connected: false, account: null });
  }
  const connection = await getConnection(viewer.user.id).catch(() => null);
  return NextResponse.json({
    configured: true,
    allowed,
    connected: Boolean(connection),
    account: connection?.accountName ?? null,
  });
}
