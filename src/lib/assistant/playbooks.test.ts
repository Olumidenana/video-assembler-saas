import { describe, expect, it } from "vitest";
import { PLAYBOOKS, playbook } from "./playbooks";

describe("audience playbooks", () => {
  it("weigh the signals to 1 and keep sensible lengths", () => {
    for (const pb of PLAYBOOKS) {
      const sum = Object.values(pb.weights).reduce((a, b) => a + b, 0);
      expect(sum, pb.id).toBeCloseTo(1, 5);
      expect(pb.range.min).toBeLessThan(pb.range.max);
      expect(pb.range.max).toBeLessThanOrEqual(60);
      expect(new Set(pb.hooks).size).toBe(4);
    }
  });

  it("never show a comedy punchline first, and keep it short", () => {
    const comedy = playbook("comedy");
    expect(comedy.coldOpen).toBe(false);
    expect(comedy.range.max).toBeLessThanOrEqual(30);
  });

  it("score anime on the peak and put phonk on fast fights, a cinematic swell on slow builds", () => {
    const anime = playbook("anime");
    expect(anime.weights.emotion).toBeGreaterThan(anime.weights.hook);
    expect(anime.music({ hook: 60, curiosity: 50, emotion: 90, value: 80, pacing: 70 })).toBe("phonk");
    expect(anime.music({ hook: 40, curiosity: 80, emotion: 90, value: 40, pacing: 30 })).toBe("cinematic");
  });

  it("keep music off talking clips that live on their words", () => {
    expect(playbook("podcast").music({ hook: 50, curiosity: 50, emotion: 50, value: 50, pacing: 50 })).toBe("none");
    expect(playbook("podcast").captions).toBe(true);
  });
});
