import { describe, expect, it } from "vitest";
import { findClipsByScene } from "@/lib/assistant/viral";
import type { ClipAnalysis } from "./analysis";
import { findMoments, outputPeak, pickHighlights, themeSongRanges } from "./highlights";

/** Deterministic pseudo-random numbers, so the synthetic episode is the same every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/**
 * A 25-minute anime-style episode in 0.5 s bins:
 *   0–90 s cold open (dialogue), 90–180 s opening theme song, dialogue scenes
 *   with one fight at 900–960 s that builds to a peak around 945 s, 1320–1410 s
 *   ending theme song, then a preview.
 */
function episode(): ClipAnalysis {
  const random = rng(7);
  const bins = 25 * 60 * 2;
  const loudness: number[] = [];
  const motion: number[] = [];
  const cuts: number[] = [];
  const theme = (t: number) => (t >= 90 && t < 180) || (t >= 1320 && t < 1410);
  for (let i = 0; i < bins; i++) {
    const t = i / 2;
    if (theme(t)) {
      loudness.push(-14 + random() * 1.5); // mastered music: loud and steady
      motion.push(6 + random() * 3);
      cuts.push(i % 3 === 0 ? 0.6 : 0);
    } else if (t >= 900 && t < 960) {
      const p = (t - 900) / 45; // rises to the peak at 945 s
      loudness.push(-26 + Math.min(1, p) * 14 + random() * 3 - (t > 950 ? 4 : 0));
      motion.push(3 + Math.min(1, p) * 9 + random() * 2);
      cuts.push(i % 3 === 0 ? 0.7 : 0);
    } else {
      // Dialogue: speech with pauses, a calm picture, a cut every ~4 s.
      const pause = random() < 0.25;
      loudness.push(pause ? -48 + random() * 4 : -27 + random() * 6);
      motion.push(0.6 + random() * 1.2);
      cuts.push(i % 8 === 0 ? 0.5 : 0);
    }
  }
  return { loudness, motion, cuts, hasAudio: true };
}

const overlap = (a: { start: number; end: number }, lo: number, hi: number) => Math.max(0, Math.min(a.end, hi) - Math.max(a.start, lo));

describe("themeSongRanges", () => {
  it("finds the opening and ending songs of an episode", () => {
    const ranges = themeSongRanges(episode()).map(([lo, hi]) => [lo / 2, hi / 2]);
    expect(ranges).toHaveLength(2);
    expect(ranges[0][0]).toBeGreaterThanOrEqual(85);
    expect(ranges[0][1]).toBeLessThanOrEqual(185);
    expect(ranges[0][1] - ranges[0][0]).toBeGreaterThanOrEqual(80);
    expect(ranges[1][0]).toBeGreaterThanOrEqual(1315);
    expect(ranges[1][1]).toBeLessThanOrEqual(1415);
  });

  it("ignores short videos", () => {
    const short = episode();
    const cut = (a: number[]) => a.slice(0, 600);
    expect(themeSongRanges({ ...short, loudness: cut(short.loudness), motion: cut(short.motion), cuts: cut(short.cuts) })).toEqual([]);
  });
});

describe("findMoments on an episode", () => {
  const a = episode();
  const duration = 1500;

  it("ranks the fight first, with a sensible length and the peak inside", () => {
    const [best] = findMoments("ep", duration, a, { minSeconds: 15, maxSeconds: 30, maxMoments: 5 });
    expect(overlap(best, 900, 960)).toBeGreaterThanOrEqual(12);
    expect(best.end - best.start).toBeGreaterThanOrEqual(15);
    expect(best.end - best.start).toBeLessThanOrEqual(30);
    expect(best.peak).toBeGreaterThan(best.start);
    expect(best.peak).toBeLessThan(best.end);
    expect(best.clean).toBe(true);
  });

  it("never picks the theme songs", () => {
    const moments = findMoments("ep", duration, a, { minSeconds: 15, maxSeconds: 30, maxMoments: 10 });
    for (const m of moments) {
      expect(overlap(m, 90, 180)).toBe(0);
      expect(overlap(m, 1320, 1410)).toBe(0);
    }
  });

  it("turns into viral clip cards with honest reasons", () => {
    const [clip] = findClipsByScene("ep", duration, a, { minSeconds: 15, maxSeconds: 30, maxClips: 5 });
    expect(overlap(clip, 900, 960)).toBeGreaterThanOrEqual(12);
    expect(clip.reasons).toContain("Starts and ends on a scene change");
  });

  it("leaves out ordinary moments instead of padding the list", () => {
    const clips = findClipsByScene("ep", duration, a, { minSeconds: 15, maxSeconds: 30, maxClips: 10 });
    expect(clips.length).toBeLessThan(10);
    for (const c of clips) expect(c.score).toBeGreaterThanOrEqual(clips[0].score * 0.65);
  });
});

describe("pickHighlights on an episode", () => {
  it("builds a 30 s reel from a few whole scenes, not scattered fragments", () => {
    const picks = pickHighlights([{ clipId: "ep", duration: 1500, analysis: episode() }], { targetSeconds: 30 });
    const total = picks.reduce((s, r) => s + r.end - r.start, 0);
    expect(picks.length).toBeLessThanOrEqual(4);
    expect(total).toBeGreaterThanOrEqual(20);
    expect(total).toBeLessThanOrEqual(36);
    for (const r of picks) {
      expect(r.end - r.start).toBeGreaterThanOrEqual(3);
      expect(overlap(r, 90, 180)).toBe(0);
    }
    expect(picks.some((r) => overlap(r, 900, 960) > 0)).toBe(true);
  });
});

describe("outputPeak", () => {
  it("finds the fight's peak in output time, for the music drop", () => {
    const analyses = new Map([["ep", episode()]]);
    // A 30 s clip from 920 s: the peak (~945 s) is ~25 s into the output.
    const t = outputPeak([{ clipId: "ep", start: 920, end: 950 }], analyses);
    expect(t).toBeGreaterThan(18);
    expect(t).toBeLessThanOrEqual(28.5);
  });

  it("falls back to a quarter of the way in without analyses", () => {
    expect(outputPeak([{ clipId: "x", start: 0, end: 4 }], new Map())).toBe(1);
  });
});
