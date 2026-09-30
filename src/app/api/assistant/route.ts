import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import type { TimelineSummary } from "@/lib/assistant/actions";
import { AssistantError, planActions } from "@/lib/assistant/claude";
import { getViewer } from "@/lib/billing/account";
import { createAdminClient } from "@/lib/supabase/admin";

/** AI requests per user per day. Simple commands are parsed in the browser and don't count. */
const DAILY_LIMIT = { free: 15, pro: 300 };

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { command?: unknown; timeline?: TimelineSummary } | null;
  const command = typeof body?.command === "string" ? body.command.trim().slice(0, 500) : "";
  if (!command) return NextResponse.json({ error: "empty" }, { status: 400 });
  const timeline = sanitizeTimeline(body?.timeline);

  const { data: allowed, error } = await createAdminClient().rpc("consume_ai_request", {
    p_user_id: viewer.user.id,
    p_limit: DAILY_LIMIT[viewer.plan],
  });
  if (error) {
    console.error("[assistant] usage check failed", error.message);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: "limit", limit: DAILY_LIMIT[viewer.plan] }, { status: 429 });

  try {
    return NextResponse.json(await planActions(command, timeline));
  } catch (err) {
    if (err instanceof AssistantError) return NextResponse.json({ error: "assistant", message: err.message }, { status: 422 });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "busy" }, { status: 503 });
    console.error("[assistant] request failed", err);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}

/** Keeps only the fields and sizes we expect from the browser. */
function sanitizeTimeline(raw: TimelineSummary | undefined): TimelineSummary {
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "video");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(36_000, v)) : 0);
  return {
    clips: (Array.isArray(raw?.clips) ? raw.clips : []).slice(0, 50).map((c) => ({ name: text(c?.name), duration: num(c?.duration) })),
    segments: (Array.isArray(raw?.segments) ? raw.segments : [])
      .slice(0, 200)
      .map((s) => ({ clip: text(s?.clip), start: num(s?.start), end: num(s?.end) })),
  };
}
