import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "./analysis";
import { autoTarget, mergeClose, pickHighlights, removeSilences, scoreClip } from "./highlights";

/** Builds an analysis from 0.5 s bins: "q" = quiet & still, "L" = loud & moving, "s" = speech-level, still. */
function analysis(pattern: string, hasAudio = true): ClipAnalysis {
  const bins = [...pattern];
  return {
    loudness: bins.map((b) => (b === "L" ? -20 : b === "s" ? -28 : -65)),
    motion: bins.map((b) => (b === "L" ? 6 : 0.2)),
    cuts: bins.map(() => 0),
    hasAudio,
  };
}

// 30 s like the browser fixture: exciting at 10–15 s and 25–30 s.
const story = "q".repeat(20) + "L".repeat(10) + "q".repeat(20) + "L".repeat(10);
const clip = (clipId: string, pattern: string, hasAudio = true) => ({
  clipId,
  duration: pattern.length * 0.5,
  analysis: analysis(pattern, hasAudio),
});

describe("scoreClip", () => {
  it("scores loud, moving moments above quiet, still ones", () => {
    const s = scoreClip(analysis(story));
    expect(s[24]).toBeGreaterThan(0.7);
    expect(s[5]).toBeLessThan(0.1);
  });

  it("ignores the frame-difference spike of a hard cut", () => {
    const a = analysis("q".repeat(20));
    a.motion[10] = 40;
    a.cuts[10] = 0.8;
    expect(Math.max(...scoreClip({ ...a, hasAudio: false }))).toBeLessThan(0.05);
  });
});

describe("pickHighlights", () => {
  it("finds the two exciting parts and keeps them in order", () => {
    const picks = pickHighlights([clip("a", story)], { targetSeconds: 10 });
    const total = picks.reduce((s, r) => s + r.end - r.start, 0);
    expect(total).toBeGreaterThanOrEqual(9.5);
    expect(total).toBeLessThanOrEqual(10.5);
    for (const r of picks) {
      const inFirst = r.start >= 9.5 && r.end <= 15.5;
      const inSecond = r.start >= 24.5 && r.end <= 30;
      expect(inFirst || inSecond).toBe(true);
    }
    expect(picks.map((r) => r.start)).toEqual([...picks.map((r) => r.start)].sort((a, b) => a - b));
  });

  it("draws from several clips and returns them in clip order", () => {
    const picks = pickHighlights([clip("a", "q".repeat(20) + "L".repeat(6)), clip("b", "L".repeat(6) + "q".repeat(20))], {
      targetSeconds: 6,
    });
    expect(picks.map((r) => r.clipId)).toEqual(["a", "b"]);
  });

  it("returns whole clips when the target is longer than the footage", () => {
    expect(pickHighlights([clip("a", "qqLL")], { targetSeconds: 60 })).toEqual([{ clipId: "a", start: 0, end: 2 }]);
  });

  it("uses motion alone for clips without sound", () => {
    const silentMover = clip("a", "q".repeat(20) + "L".repeat(8) + "q".repeat(20), false);
    const picks = pickHighlights([silentMover], { targetSeconds: 4 });
    expect(picks[0].start).toBeGreaterThanOrEqual(9.5);
    expect(picks[0].end).toBeLessThanOrEqual(14.5);
  });
});

describe("removeSilences", () => {
  it("cuts out quiet stretches and pads the kept parts", () => {
    const ranges = removeSilences([clip("a", story)]);
    expect(ranges).toEqual([
      { clipId: "a", start: 9.75, end: 15.25 },
      { clipId: "a", start: 24.75, end: 30 },
    ]);
  });

  it("keeps short pauses between words", () => {
    const ranges = removeSilences([clip("a", "qqqq" + "ssss" + "q" + "ssss" + "qqqq")]);
    expect(ranges).toHaveLength(1);
  });

  it("keeps clips without audio whole", () => {
    expect(removeSilences([clip("a", "qqqq", false)])).toEqual([{ clipId: "a", start: 0, end: 2 }]);
  });
});

describe("helpers", () => {
  it("suggests ~20% of the footage, between 10 and 90 seconds", () => {
    expect(autoTarget(20)).toBe(10);
    expect(autoTarget(200)).toBe(40);
    expect(autoTarget(3600)).toBe(90);
  });

  it("merges close ranges of the same clip only", () => {
    expect(
      mergeClose(
        [
          { clipId: "a", start: 0, end: 2 },
          { clipId: "a", start: 2.5, end: 4 },
          { clipId: "b", start: 4.2, end: 5 },
        ],
        1,
      ),
    ).toEqual([
      { clipId: "a", start: 0, end: 4 },
      { clipId: "b", start: 4.2, end: 5 },
    ]);
  });
});
