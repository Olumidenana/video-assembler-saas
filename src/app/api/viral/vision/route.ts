import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { AssistantError, judgeClipsVisually, type VisionCandidate } from "@/lib/assistant/claude";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/** A vision review looks at dozens of frames, so it counts as this many AI requests. */
const VISION_COST = 10;
const MAX_CLIPS = 10;
const MAX_FRAMES = 4;
/** Base64 length of a ~150 KB JPEG; the editor sends ~25 KB frames. */
const MAX_FRAME_CHARS = 200_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * AI Vision (Studio): Claude judges candidate clips from a few still frames
 * each and writes their hook, title and caption. Only these small stills
 * leave the device, never the video.
 */
export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  if (!PLAN_LIMITS[viewer.plan].aiVision) return NextResponse.json({ error: "upgrade" }, { status: 402 });

  const body = (await request.json().catch(() => null)) as { clips?: unknown } | null;
  const candidates: VisionCandidate[] = (Array.isArray(body?.clips) ? body.clips : []).slice(0, MAX_CLIPS).flatMap(
    (c: { id?: unknown; start?: unknown; end?: unknown; notes?: unknown; frames?: unknown }) => {
      if (typeof c?.id !== "string" || typeof c.start !== "number" || typeof c.end !== "number" || !(c.end > c.start)) return [];
      const frames = (Array.isArray(c.frames) ? c.frames : [])
        .slice(0, MAX_FRAMES)
        .filter((f): f is string => typeof f === "string" && f.length > 100 && f.length <= MAX_FRAME_CHARS && BASE64.test(f) && f.startsWith("/9j/"));
      if (frames.length === 0) return [];
      return [{ id: c.id.slice(0, 40), start: c.start, end: c.end, notes: typeof c.notes === "string" ? c.notes.slice(0, 300) : "", frames }];
    },
  );
  if (candidates.length === 0) return NextResponse.json({ error: "no_frames" }, { status: 400 });

  const { data: allowed, error } = await createAdminClient().rpc("consume_ai_request", {
    p_user_id: viewer.user.id,
    p_limit: PLAN_LIMITS[viewer.plan].aiDailyLimit,
    p_cost: VISION_COST,
  });
  if (error) {
    console.error("[vision] usage check failed", error.message);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: "limit" }, { status: 429 });

  try {
    return NextResponse.json({ clips: await judgeClipsVisually(candidates) });
  } catch (err) {
    if (err instanceof AssistantError) return NextResponse.json({ error: "assistant", message: err.message }, { status: 422 });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "busy" }, { status: 503 });
    console.error("[vision] request failed", err);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
