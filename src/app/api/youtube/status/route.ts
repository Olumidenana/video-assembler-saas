import { NextResponse } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { getConnection, youtubeConfigured } from "@/lib/social/youtube";

/** Whether YouTube posting is set up on this site, allowed on this plan, and connected. */
export async function GET() {
  const viewer = await getViewer();
  const allowed = PLAN_LIMITS[viewer.plan].directPost;
  if (!youtubeConfigured() || !viewer.user || !allowed) {
    return NextResponse.json({ configured: youtubeConfigured(), allowed, connected: false, account: null });
  }
  const connection = await getConnection(viewer.user.id).catch(() => null);
  return NextResponse.json({ configured: true, allowed, connected: Boolean(connection), account: connection?.accountName ?? null });
}
