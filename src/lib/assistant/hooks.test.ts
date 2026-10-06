import { describe, expect, it } from "vitest";
import { HOOK_LIBRARY, hookFamily, pickHooks } from "./hooks";

const scores = (over: Partial<Record<"hook" | "curiosity" | "emotion" | "value" | "pacing", number>> = {}) => ({
  hook: 50,
  curiosity: 40,
  emotion: 50,
  value: 50,
  pacing: 30,
  ...over,
});

describe("hook library", () => {
  it("matches the technique to the clip's shape", () => {
    expect(hookFamily(scores({ curiosity: 80 }))).toBe("curiosity");
    expect(hookFamily(scores({ emotion: 95 }))).toBe("stakes");
    expect(hookFamily(scores({ pacing: 80 }))).toBe("interrupt");
    expect(hookFamily(scores())).toBe("payoff");
  });

  it("never repeats a hook within a pack, even for similar clips", () => {
    const hooks = pickHooks(Array.from({ length: 8 }, () => ({ scores: scores({ curiosity: 90 }), title: "Scene 1" })), "scenes");
    expect(new Set(hooks).size).toBe(8);
    expect(HOOK_LIBRARY.curiosity).toContain(hooks[0]);
  });

  it("uses a talking clip's own short opening line", () => {
    const [hook] = pickHooks([{ scores: scores(), title: "Nobody tells you this about money" }], "transcript");
    expect(hook).toBe("Nobody tells you this about money");
  });

  it("keeps every hook short enough to read in a second", () => {
    for (const line of Object.values(HOOK_LIBRARY).flat()) expect(line.split(/\s+/).length).toBeLessThanOrEqual(6);
  });
});
