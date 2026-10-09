import { NextResponse } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { deleteConnection, getConnection, refreshAccess, tiktokConfigured } from "@/lib/social/tiktok";

/** Provides a short-lived access token for browser-side upload to TikTok. */
export async function POST() {
  if (!tiktokConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  if (!PLAN_LIMITS[viewer.plan].directPost) return NextResponse.json({ error: "upgrade" }, { status: 402 });

  const connection = await getConnection(viewer.user.id);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  try {
    const { access_token, expires_in, open_id } = await refreshAccess(connection.refreshToken);
    return NextResponse.json(
      { accessToken: access_token, expiresIn: expires_in, openId: open_id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[tiktok] refresh failed", err);
    await deleteConnection(viewer.user.id).catch(() => {});
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }
}
