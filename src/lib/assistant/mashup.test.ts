import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "@/lib/video/analysis";
import { arrange, type Beat, findBeats, suggestMashups, transitionFor } from "./mashup";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/**
 * A 10-minute episode in 0.5 s bins: dialogue, a fight at `fight` s (60 s,
 * building), and a quiet emotional scene at `sad` s (30 s, still, with a soft
 * score playing and long shots).
 */
function episode(seed: number, fight: number, sad: number): ClipAnalysis {
  const random = rng(seed);
  const loudness: number[] = [];
  const motion: number[] = [];
  const cuts: number[] = [];
  for (let i = 0; i < 1200; i++) {
    const t = i / 2;
    if (t >= fight && t < fight + 60) {
      const p = Math.min(1, (t - fight) / 45);
      loudness.push(-26 + p * 14 + random() * 3);
      motion.push(3 + p * 9 + random() * 2);
      cuts.push(i % 3 === 0 ? 0.7 : 0);
    } else if (t >= sad && t < sad + 30) {
      loudness.push(-34 + random() * 2);
      motion.push(0.3 + random() * 0.3);
      cuts.push(i % 24 === 0 ? 0.6 : 0);
    } else {
      const pause = random() < 0.25;
      loudness.push(pause ? -50 : -24 + random() * 4);
      motion.push(1.5 + random() * 1.5);
      cuts.push(i % 8 === 0 ? 0.5 : 0);
    }
  }
  return { loudness, motion, cuts, hasAudio: true };
}

const videos = [
  { clipId: "a", duration: 600, analysis: episode(1, 300, 120) },
  { clipId: "b", duration: 600, analysis: episode(2, 420, 200) },
];
const inside = (b: Beat, lo: number, hi: number) => b.start >= lo - 1 && b.end <= hi + 1;

describe("mashups", () => {
  it("finds the fights and the quiet scenes in both videos", () => {
    const beats = findBeats(videos);
    const energetic = beats.filter((b) => b.mood !== "feels").sort((x, y) => y.fit - x.fit);
    expect(inside(energetic.find((b) => b.clipId === "a")!, 300, 360)).toBe(true);
    expect(inside(energetic.find((b) => b.clipId === "b")!, 420, 480)).toBe(true);
    const feels = beats.filter((b) => b.mood === "feels");
    expect(feels.some((b) => b.clipId === "a" && inside(b, 120, 150))).toBe(true);
    expect(feels.some((b) => b.clipId === "b" && inside(b, 200, 230))).toBe(true);
  });

  it("suggests mashups that cut between the videos, 3-7 s beats, under 40 s", () => {
    const mashups = suggestMashups(videos);
    expect(mashups.length).toBeGreaterThanOrEqual(2);
    for (const m of mashups) {
      expect(new Set(m.beats.map((b) => b.clipId)).size).toBe(2);
      expect(m.length).toBeLessThanOrEqual(40);
      for (const b of m.beats) expect(b.end - b.start).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < m.beats.length; i++) {
        const ids = new Set(m.beats.map((b) => b.id));
        expect(ids.size).toBe(m.beats.length);
      }
    }
    expect(mashups.find((m) => m.id === "feels")?.music).toBe("lofi");
    // These videos' energetic moments are all fights, so "best of" would repeat "Fights & action".
    expect(mashups.map((m) => m.id)).not.toContain("best");
  });

  it("tags the payoff of a build-up as rising", () => {
    const a = episode(3, 300, 120);
    // 20 s of quiet tension, then a sudden burst at 250 s.
    for (let i = 460; i < 500; i++) {
      a.loudness[i] = -40;
      a.motion[i] = 0.8;
      a.cuts[i] = 0;
    }
    for (let i = 500; i < 512; i++) {
      a.loudness[i] = -10;
      a.motion[i] = 14;
      a.cuts[i] = i % 3 === 0 ? 0.7 : 0;
    }
    const burst = findBeats([{ clipId: "c", duration: 600, analysis: a }]).find((b) => b.start < 256 && b.end > 250);
    expect(burst?.mood).toBe("rising");
  });

  it("orders beats as an arc, strongest last, alternating videos", () => {
    const beat = (clipId: string, fit: number): Beat => ({ id: `${clipId}${fit}`, clipId, start: fit * 100, end: fit * 100 + 4, peak: 0, mood: "action", fit });
    const order = arrange([beat("a", 0.9), beat("a", 0.5), beat("a", 0.4), beat("b", 0.6), beat("b", 0.7), beat("b", 0.3)]);
    expect(order.at(-1)!.fit).toBe(0.9);
    expect(order[0].fit).toBe(0.7);
    for (let i = 1; i < order.length; i++) expect(order[i].clipId).not.toBe(order[i - 1].clipId);
  });

  it("picks transitions to suit the beat in a mixed mashup", () => {
    const b = (mood: Beat["mood"]): Beat => ({ id: mood, clipId: "a", start: 0, end: 4, peak: 2, mood, fit: 1 });
    expect(transitionFor({ id: "best", transition: "fadewhite" }, b("feels"))).toBe("fade");
    expect(transitionFor({ id: "best", transition: "fadewhite" }, b("rising"))).toBe("zoomin");
    expect(transitionFor({ id: "action", transition: "fadewhite" }, b("feels"))).toBe("fadewhite");
    expect(transitionFor({ id: "action", transition: "fadewhite" }, b("feels"), "smoothleft")).toBe("smoothleft");
  });
});
