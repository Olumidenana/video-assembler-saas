import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { AssistantError, matchThemes, type ThemeCandidate } from "@/lib/assistant/claude";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/** Looks at dozens of frames, like AI Vision, so it costs the same. */
const THEME_COST = 10;
const MAX_MOMENTS = 18;
const MAX_FRAMES = 3;
const MAX_FRAME_CHARS = 200_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * AI Theme Match (Studio): Claude looks at a few stills from moments across
 * several videos and groups the ones that share a theme into mashups. Only
 * the stills leave the device.
 */
export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  if (!PLAN_LIMITS[viewer.plan].aiVision) return NextResponse.json({ error: "upgrade" }, { status: 402 });

  const body = (await request.json().catch(() => null)) as { moments?: unknown } | null;
  const candidates: ThemeCandidate[] = (Array.isArray(body?.moments) ? body.moments : []).slice(0, MAX_MOMENTS).flatMap(
    (c: { id?: unknown; video?: unknown; start?: unknown; end?: unknown; notes?: unknown; frames?: unknown }) => {
      if (typeof c?.id !== "string" || typeof c.video !== "string" || typeof c.start !== "number" || typeof c.end !== "number" || !(c.end > c.start)) return [];
      const frames = (Array.isArray(c.frames) ? c.frames : [])
        .slice(0, MAX_FRAMES)
        .filter((f): f is string => typeof f === "string" && f.length > 100 && f.length <= MAX_FRAME_CHARS && BASE64.test(f) && f.startsWith("/9j/"));
      if (frames.length === 0) return [];
      return [{ id: c.id.slice(0, 40), video: c.video.slice(0, 80), start: c.start, end: c.end, notes: typeof c.notes === "string" ? c.notes.slice(0, 300) : "", frames }];
    },
  );
  if (new Set(candidates.map((c) => c.video)).size < 2) return NextResponse.json({ error: "no_frames" }, { status: 400 });

  const { data: allowed, error } = await createAdminClient().rpc("consume_ai_request", {
    p_user_id: viewer.user.id,
    p_limit: PLAN_LIMITS[viewer.plan].aiDailyLimit,
    p_cost: THEME_COST,
  });
  if (error) {
    console.error("[themes] usage check failed", error.message);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: "limit" }, { status: 429 });

  try {
    return NextResponse.json({ mashups: await matchThemes(candidates) });
  } catch (err) {
    if (err instanceof AssistantError) return NextResponse.json({ error: "assistant", message: err.message }, { status: 422 });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "busy" }, { status: 503 });
    console.error("[themes] request failed", err);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
