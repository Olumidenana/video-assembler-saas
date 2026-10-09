import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { authUrl, tiktokConfigured } from "@/lib/social/tiktok";

/** Starts connecting a TikTok account with PKCE (opened in popup from the editor). */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  if (!tiktokConfigured()) return NextResponse.redirect(new URL("/tiktok-connected?error=not_configured", origin));
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.redirect(new URL("/login?next=/tiktok-connected", origin));
  if (!PLAN_LIMITS[viewer.plan].directPost) return NextResponse.redirect(new URL("/tiktok-connected?error=upgrade", origin));

  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const res = NextResponse.redirect(authUrl(state, challenge));
  res.cookies.set("tt_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/tiktok", maxAge: 600 });
  res.cookies.set("tt_verifier", verifier, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/tiktok", maxAge: 600 });
  return res;
}
