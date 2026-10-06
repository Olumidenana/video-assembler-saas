import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = { messages: { create } };
    static RateLimitError = class extends Error {};
  }
  return { default: Anthropic };
});

let viewer: { user: { id: string } | null; plan: "free" | "pro" | "studio" } = { user: { id: "u1" }, plan: "free" };
vi.mock("@/lib/billing/account", () => ({ getViewer: async () => viewer }));

let allowed = true;
const rpc = vi.fn(async () => ({ data: allowed, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const { planActions } = await import("./claude");
const { POST } = await import("@/app/api/assistant/route");

const reply = (json: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: JSON.stringify(json) }],
});

const timeline = { clips: [{ name: "party.mp4", duration: 120 }], segments: [{ clip: "party.mp4", start: 0, end: 120 }] };

beforeEach(() => {
  create.mockReset();
  rpc.mockClear();
  allowed = true;
  viewer = { user: { id: "u1" }, plan: "free" };
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

describe("planActions", () => {
  it("asks Claude for structured actions and cleans the result", async () => {
    create.mockResolvedValue(
      reply({
        reply: "Made a 45s highlight and moved it up.",
        actions: [
          { type: "highlights", seconds: 45, segment: null, start: null, end: null, to: null, mode: "none" },
          { type: "export", seconds: null, segment: null, start: null, end: null, to: null, mode: "parts" },
          { type: "split_every", seconds: -1, segment: null, start: null, end: null, to: null, mode: "none" },
        ],
      }),
    );
    const result = await planActions("45s highlight then export each part", timeline);

    expect(result).toEqual({
      reply: "Made a 45s highlight and moved it up.",
      actions: [{ type: "highlights", seconds: 45 }, { type: "export", mode: "parts" }],
    });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.messages[0].content).toContain('1. "party.mp4" (120.0s)');
  });

  it("reports refusals instead of reading content", async () => {
    create.mockResolvedValue(reply({}, "refusal"));
    await expect(planActions("something", timeline)).rejects.toThrow("can't help");
  });
});

describe("POST /api/assistant", () => {
  const call = (body: unknown) =>
    POST(new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify(body) }));

  it("is unavailable without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await call({ command: "hi" })).status).toBe(503);
  });

  it("requires sign-in", async () => {
    viewer = { user: null, plan: "free" };
    expect((await call({ command: "hi" })).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("enforces the daily limit per plan", async () => {
    allowed = false;
    const res = await call({ command: "make it shorter", timeline });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limit: 5 });
    expect(rpc).toHaveBeenCalledWith("consume_ai_request", { p_user_id: "u1", p_limit: 5 });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns planned actions", async () => {
    viewer = { user: { id: "u2" }, plan: "pro" };
    create.mockResolvedValue(reply({ reply: "Removed segment 2.", actions: [{ type: "remove_segment", seconds: null, segment: 2, start: null, end: null, to: null, mode: "none" }] }));
    const res = await call({ command: "drop the second part", timeline });
    expect(await res.json()).toEqual({ reply: "Removed segment 2.", actions: [{ type: "remove_segment", segment: 2 }] });
    expect(rpc).toHaveBeenCalledWith("consume_ai_request", { p_user_id: "u2", p_limit: 40 });
  });
});

describe("planViralClips", () => {
  it("returns validated clips in sentence ranges", async () => {
    const { planViralClips } = await import("./claude");
    create.mockResolvedValue(
      reply({
        clips: [
          { start_sentence: 1, end_sentence: 3, hook: 92, curiosity: 80, emotion: 140, value: 70, pacing: 60, reasons: ["Bold claim"], title: "Why you're still broke", caption: "Save this 💰", hashtags: ["money", "#lagos"] },
          { start_sentence: 4, end_sentence: 99, hook: 50, curiosity: 50, emotion: 50, value: 50, pacing: 50, reasons: [], title: "", caption: "", hashtags: [] },
        ],
      }),
    );
    const sentences = Array.from({ length: 6 }, (_, i) => ({ text: `Sentence ${i}.`, start: i * 5, end: i * 5 + 4 }));
    const clips = await planViralClips(sentences, { minSeconds: 10, maxSeconds: 30, count: 5 });

    expect(clips).toEqual([
      {
        startSentence: 1,
        endSentence: 3,
        scores: { hook: 92, curiosity: 80, emotion: 100, value: 70, pacing: 60 },
        reasons: ["Bold claim"],
        title: "Why you're still broke",
        caption: "Save this 💰",
        hashtags: ["#money", "#lagos"],
      },
    ]);
    const params = create.mock.calls[0][0];
    expect(params.system).toContain("content psychology");
    expect(params.messages[0].content).toContain("[2] (10.0-14.0s) Sentence 2.");
  });
});

describe("AI Vision", () => {
  const jpeg = "/9j/" + "A".repeat(400);
  const clip = (id: string) => ({ id, start: 10, end: 30, notes: "Peak at 0:18", frames: [jpeg, jpeg] });

  it("sends each clip's frames as images and validates the verdicts", async () => {
    const { judgeClipsVisually } = await import("./claude");
    create.mockResolvedValue(
      reply({
        clips: [
          { id: "a", score: 140, what: "A fighter lands the final blow.", why: "Clear payoff.", hook: "He didn't see it coming 😳", title: "The final blow", caption: "Wait for it", hashtags: ["anime", "#edit"], keep: true },
          { id: "zz", score: 90, what: "", why: "", hook: "", title: "", caption: "", hashtags: [], keep: true },
          { id: "b", score: 20, what: "Two people talk.", why: "Slow.", hook: "Listen", title: "Talk", caption: "", hashtags: [], keep: false },
        ],
      }),
    );
    const verdicts = await judgeClipsVisually([clip("a"), clip("b")]);
    expect(verdicts.map((v) => [v.id, v.score, v.keep])).toEqual([
      ["a", 100, true],
      ["b", 20, false],
    ]);
    expect(verdicts[0].hook).toBe("He didn't see it coming");
    expect(verdicts[0].hashtags).toEqual(["#anime", "#edit"]);
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content.filter((b: { type: string }) => b.type === "image")).toHaveLength(4);
    expect(content[2]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg } });
  });

  it("is Studio-only and charges 10 AI credits", async () => {
    const { POST: vision } = await import("@/app/api/viral/vision/route");
    const req = (clips: unknown) => new NextRequest("http://x/api/viral/vision", { method: "POST", body: JSON.stringify({ clips }) });

    viewer = { user: { id: "u1" }, plan: "pro" };
    expect((await vision(req([clip("a")]))).status).toBe(402);

    viewer = { user: { id: "u1" }, plan: "studio" };
    expect((await vision(req([{ ...clip("a"), frames: ["not-a-jpeg"] }]))).status).toBe(400);

    create.mockResolvedValue(reply({ clips: [{ id: "a", score: 80, what: "x", why: "y", hook: "z", title: "t", caption: "c", hashtags: [], keep: true }] }));
    const res = await vision(req([clip("a")]));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("consume_ai_request", { p_user_id: "u1", p_limit: 80, p_cost: 10 });
  });
});
