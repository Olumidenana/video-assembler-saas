import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";

/**
 * Short-lived streaming relay for TikTok video chunk upload:
 * Used if the browser in cross-origin isolated mode (COOP/COEP) encounters CORS
 * restrictions from TikTok's upload CDN. It streams the bytes directly to TikTok
 * without storing or caching any video data on the server.
 */
export async function PUT(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  if (!PLAN_LIMITS[viewer.plan].directPost) return NextResponse.json({ error: "upgrade" }, { status: 402 });

  const targetUrl = request.headers.get("x-upload-url") || request.nextUrl.searchParams.get("url");
  if (!targetUrl || !targetUrl.startsWith("https://")) {
    return NextResponse.json({ error: "invalid_upload_url" }, { status: 400 });
  }

  const contentRange = request.headers.get("content-range");
  const contentType = request.headers.get("content-type") || "video/mp4";

  try {
    const upstreamHeaders: Record<string, string> = {
      "Content-Type": contentType,
    };
    if (contentRange) upstreamHeaders["Content-Range"] = contentRange;

    const res = await fetch(targetUrl, {
      method: "PUT",
      headers: upstreamHeaders,
      // @ts-expect-error duplex is required in Node 18+ fetch for streaming request bodies
      duplex: "half",
      body: request.body,
    });

    const responseBody = await res.text().catch(() => "");
    return new NextResponse(responseBody, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    console.error("[tiktok] upload relay error", err);
    return NextResponse.json({ error: "relay_failed", message: err instanceof Error ? err.message : "Relay failed" }, { status: 502 });
  }
}
