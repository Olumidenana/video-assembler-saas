import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { channelName, exchangeCode, saveConnection } from "@/lib/social/youtube";

/** Google sends the creator back here after they allow posting to their channel. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/youtube-connected?${result}`, origin));
    res.cookies.delete({ name: "yt_state", path: "/api/youtube" });
    return res;
  };
  const state = request.cookies.get("yt_state")?.value;
  const code = searchParams.get("code");
  if (!state || state !== searchParams.get("state")) return done("error=state");
  if (!code) return done(`error=${searchParams.get("error") === "access_denied" ? "denied" : "failed"}`);
  const viewer = await getViewer();
  if (!viewer.user) return done("error=sign_in");
  if (!PLAN_LIMITS[viewer.plan].directPost) return done("error=upgrade");
  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) return done("error=failed");
    await saveConnection(viewer.user.id, tokens.refresh_token, await channelName(tokens.access_token));
    return done("ok=1");
  } catch (err) {
    console.error("[youtube] connect failed", err);
    return done("error=failed");
  }
}
