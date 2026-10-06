import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "@/lib/video/analysis";
import { findHits, planEdits, shortName } from "./beat-edit";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/** 10 minutes: dialogue, a 60 s fight at `fight` with impacts every ~2.5 s, a quiet 30 s scene at `sad`. */
function episode(seed: number, fight: number, sad: number): ClipAnalysis {
  const random = rng(seed);
  const loudness: number[] = [];
  const motion: number[] = [];
  const cuts: number[] = [];
  for (let i = 0; i < 1200; i++) {
    const t = i / 2;
    if (t >= fight && t < fight + 60) {
      const impact = i % 5 === 0;
      loudness.push((impact ? -8 : -20) + random() * 3);
      motion.push((impact ? 14 : 7) + random() * 2);
      cuts.push(i % 3 === 0 ? 0.7 : 0);
    } else if (t >= sad && t < sad + 30) {
      loudness.push(-34 + random() * 2);
      motion.push(0.3 + random() * 0.3);
      cuts.push(i % 24 === 0 ? 0.6 : 0);
    } else {
      loudness.push(random() < 0.25 ? -50 : -24 + random() * 4);
      motion.push(1.5 + random() * 1.5);
      cuts.push(i % 8 === 0 ? 0.5 : 0);
    }
  }
  return { loudness, motion, cuts, hasAudio: true };
}

const videos = [
  { clipId: "a", name: "black_clover_ep15.mp4", duration: 600, analysis: episode(1, 300, 120) },
  { clipId: "b", name: "naruto-shippuden-133.mkv", duration: 600, analysis: episode(2, 420, 200) },
];

describe("beat edits", () => {
  it("finds the impacts in the fights", () => {
    const hits = findHits(videos[0]);
    expect(hits.length).toBeGreaterThan(10);
    for (const h of hits.slice(0, 10)) expect(h.t).toBeGreaterThanOrEqual(299);
    for (const h of hits.slice(0, 10)) expect(h.t).toBeLessThanOrEqual(361);
  });

  it("lays a hype edit on the beat: 9 bars, the drop after 4, the big hit on it", () => {
    const hype = planEdits(videos).find((p) => p.id === "hype")!;
    const beat = 60 / 130;
    expect(hype.shots.reduce((s, x) => s + x.beats, 0)).toBe(36);
    expect(hype.length).toBeCloseTo(36 * beat, 2);
    expect(hype.dropAt).toBeCloseTo(16 * beat, 2);
    const firstDrop = hype.shots.findIndex((s) => s.role === "drop");
    expect(hype.shots.slice(0, firstDrop).reduce((s, x) => s + x.beats, 0)).toBe(16);
    expect(hype.shots[firstDrop].fx).toMatchObject({ punch: true, shake: true });
    // Every shot is exactly as long as its beats (slow motion: half the source plays twice as long).
    for (const s of hype.shots) expect((s.end - s.start) / (s.speed ?? 1)).toBeCloseTo(s.beats * beat, 2);
    const last = hype.shots.at(-1)!;
    expect(last.role).toBe("outro");
    expect(last.speed).toBe(0.5);
    // Cuts every beat in the drop, from both videos, never reusing footage.
    expect(hype.shots.filter((s) => s.role === "drop" && s.beats === 1).length).toBeGreaterThanOrEqual(10);
    expect(new Set(hype.shots.map((s) => s.clipId)).size).toBe(2);
    for (const [i, x] of hype.shots.entries())
      for (const y of hype.shots.slice(i + 1)) if (x.clipId === y.clipId) expect(x.end <= y.start || y.end <= x.start).toBe(true);
  });

  it("makes a versus edit that alternates the two videos through the drop", () => {
    const vs = planEdits(videos).find((p) => p.id === "versus")!;
    expect(vs.title).toBe("black clover ep15 vs naruto shippuden…");
    const drop = vs.shots.filter((s) => s.role === "drop");
    let switches = 0;
    for (let i = 1; i < drop.length; i++) if (drop[i].clipId !== drop[i - 1].clipId) switches++;
    expect(switches).toBeGreaterThanOrEqual(drop.length - 3);
  });

  it("makes an emotional edit from the quiet scenes, cut on the bar", () => {
    const feels = planEdits(videos).find((p) => p.id === "feels")!;
    expect(feels.music).toBe("cinematic");
    const quiet = feels.shots.filter((s) => s.role !== "outro").filter((s) => (s.clipId === "a" ? s.start >= 118 && s.end <= 152 : s.start >= 198 && s.end <= 232));
    expect(quiet.length).toBeGreaterThanOrEqual(feels.shots.length / 2);
  });

  it("makes a hype and an emotional edit from a single episode", () => {
    const plans = planEdits([videos[0]]);
    expect(plans.map((p) => p.id)).toEqual(["hype", "feels"]);
    expect(plans[0].shots.filter((s) => s.role === "drop").length).toBeGreaterThanOrEqual(10);
  });

  it("still makes an edit from one video with only a short fight", () => {
    const short = episode(5, 300, 120);
    // Only 15 s of fight: not enough big hits for 13 distinct drop cuts.
    for (let i = 630; i < 720; i++) {
      short.loudness[i] = -24 + (i % 3);
      short.motion[i] = 2;
    }
    const plans = planEdits([{ clipId: "s", name: "one.mp4", duration: 600, analysis: short }]);
    const hype = plans.find((p) => p.id === "hype")!;
    expect(hype).toBeDefined();
    expect(hype.shots.reduce((s, x) => s + x.beats, 0)).toBe(36);
  });

  it("shortens file names for the screen", () => {
    expect(shortName("black_clover_ep15.mp4")).toBe("black clover ep15");
    expect(shortName("a-very-long-file-name-for-a-movie.mp4")).toBe("a very long file…");
  });
});
