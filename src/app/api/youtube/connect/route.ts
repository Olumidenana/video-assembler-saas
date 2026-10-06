import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { authUrl, youtubeConfigured } from "@/lib/social/youtube";

/** Starts connecting a YouTube channel (opened in a popup from the editor). */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  if (!youtubeConfigured()) return NextResponse.redirect(new URL("/youtube-connected?error=not_configured", origin));
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.redirect(new URL("/login?next=/youtube-connected", origin));
  if (!PLAN_LIMITS[viewer.plan].directPost) return NextResponse.redirect(new URL("/youtube-connected?error=upgrade", origin));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("yt_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/youtube", maxAge: 600 });
  return res;
}
