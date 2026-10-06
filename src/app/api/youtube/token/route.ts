import { NextResponse } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { deleteConnection, getConnection, refreshAccess, youtubeConfigured } from "@/lib/social/youtube";

/** A short-lived token the browser uses to upload one video straight to YouTube. */
export async function POST() {
  if (!youtubeConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  if (!PLAN_LIMITS[viewer.plan].directPost) return NextResponse.json({ error: "upgrade" }, { status: 402 });
  const connection = await getConnection(viewer.user.id);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 409 });
  try {
    const { access_token, expires_in } = await refreshAccess(connection.refreshToken);
    return NextResponse.json({ accessToken: access_token, expiresIn: expires_in }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // The creator revoked access on Google's side: forget it so they can reconnect.
    console.error("[youtube] refresh failed", err);
    await deleteConnection(viewer.user.id).catch(() => {});
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }
}
