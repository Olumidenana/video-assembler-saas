import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { accountName, exchangeCode, saveConnection } from "@/lib/social/tiktok";

/** TikTok sends the creator back here after they approve posting. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/tiktok-connected?${result}`, origin));
    res.cookies.delete({ name: "tt_state", path: "/api/tiktok" });
    res.cookies.delete({ name: "tt_verifier", path: "/api/tiktok" });
    return res;
  };

  const state = request.cookies.get("tt_state")?.value;
  const verifier = request.cookies.get("tt_verifier")?.value;
  const code = searchParams.get("code");

  if (!state || state !== searchParams.get("state") || !verifier) return done("error=state");
  if (!code) return done(`error=${searchParams.get("error") === "access_denied" ? "denied" : "failed"}`);

  const viewer = await getViewer();
  if (!viewer.user) return done("error=sign_in");
  if (!PLAN_LIMITS[viewer.plan].directPost) return done("error=upgrade");

  try {
    const tokens = await exchangeCode(code, verifier);
    if (!tokens.refresh_token) return done("error=failed");
    const name = await accountName(tokens.access_token);
    await saveConnection(viewer.user.id, tokens.refresh_token, name);
    return done("ok=1");
  } catch (err) {
    console.error("[tiktok] connect failed", err);
    return done("error=failed");
  }
}
