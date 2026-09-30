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

let viewer: { user: { id: string } | null; plan: "free" | "pro" } = { user: { id: "u1" }, plan: "free" };
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
    expect(await res.json()).toMatchObject({ limit: 15 });
    expect(rpc).toHaveBeenCalledWith("consume_ai_request", { p_user_id: "u1", p_limit: 15 });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns planned actions", async () => {
    viewer = { user: { id: "u2" }, plan: "pro" };
    create.mockResolvedValue(reply({ reply: "Removed segment 2.", actions: [{ type: "remove_segment", seconds: null, segment: 2, start: null, end: null, to: null, mode: "none" }] }));
    const res = await call({ command: "drop the second part", timeline });
    expect(await res.json()).toEqual({ reply: "Removed segment 2.", actions: [{ type: "remove_segment", segment: 2 }] });
    expect(rpc).toHaveBeenCalledWith("consume_ai_request", { p_user_id: "u2", p_limit: 300 });
  });
});
