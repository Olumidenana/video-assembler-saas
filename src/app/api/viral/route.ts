import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { AssistantError, planViralClips } from "@/lib/assistant/claude";
import { getViewer } from "@/lib/billing/account";
import { PLAN_LIMITS } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/** A viral analysis reads a whole transcript, so it counts as this many AI requests. */
const VIRAL_COST = 10;
/** About an hour of speech; longer transcripts are cut (the browser sends the part to analyse). */
const MAX_SENTENCES = 1500;

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  if (viewer.plan === "free") return NextResponse.json({ error: "upgrade" }, { status: 402 });

  const body = (await request.json().catch(() => null)) as {
    sentences?: unknown;
    minSeconds?: unknown;
    maxSeconds?: unknown;
    count?: unknown;
  } | null;
  const sentences = (Array.isArray(body?.sentences) ? body.sentences : [])
    .slice(0, MAX_SENTENCES)
    .flatMap((s: { text?: unknown; start?: unknown; end?: unknown }) =>
      typeof s?.text === "string" && typeof s.start === "number" && typeof s.end === "number"
        ? [{ text: s.text.slice(0, 400), start: s.start, end: s.end }]
        : [],
    );
  if (sentences.length < 3) return NextResponse.json({ error: "too_short" }, { status: 400 });
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);
  const minSeconds = num(body?.minSeconds, 5, 120, 15);
  const maxSeconds = num(body?.maxSeconds, minSeconds, 180, 60);
  const count = num(body?.count, 1, 10, 6);

  const { data: allowed, error } = await createAdminClient().rpc("consume_ai_request", {
    p_user_id: viewer.user.id,
    p_limit: PLAN_LIMITS[viewer.plan].aiDailyLimit,
    p_cost: VIRAL_COST,
  });
  if (error) {
    console.error("[viral] usage check failed", error.message);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: "limit" }, { status: 429 });

  try {
    return NextResponse.json({ clips: await planViralClips(sentences, { minSeconds, maxSeconds, count }) });
  } catch (err) {
    if (err instanceof AssistantError) return NextResponse.json({ error: "assistant", message: err.message }, { status: 422 });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "busy" }, { status: 503 });
    console.error("[viral] request failed", err);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
