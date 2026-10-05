import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/video/captions";
import { findViralClips, localPostKit, overallScore, scoreCandidate, toSentences } from "./viral";

/** Speaks sentences back to back at ~3 words/second with short pauses between. */
function speak(sentences: string[], startAt = 0): Word[] {
  const words: Word[] = [];
  let t = startAt;
  for (const s of sentences) {
    for (const w of s.split(" ")) {
      words.push({ text: w, start: t, end: t + 0.3 });
      t += 0.33;
    }
    t += 0.4;
  }
  return words;
}

const filler = Array.from({ length: 12 }, () => "So yeah we went to the market and it was fine and then we came back home.");
const viral = [
  "Nobody tells you this about saving money in Lagos?",
  "Here's why most people stay broke even with a good salary.",
  "The secret is simple but it changed my life completely!",
  "First you pay yourself before you pay anyone else.",
  "Second you stop buying things to impress people you don't like.",
  "That's why I saved two million naira in one year.",
];

describe("toSentences", () => {
  it("splits on punctuation and long pauses", () => {
    const words: Word[] = [
      { text: "Hello", start: 0, end: 0.3 },
      { text: "there.", start: 0.3, end: 0.6 },
      { text: "Okay", start: 0.7, end: 1 },
      { text: "then", start: 2.5, end: 2.8 },
    ];
    expect(toSentences(words).map((s) => s.text)).toEqual(["Hello there.", "Okay", "then"]);
  });
});

describe("scoring", () => {
  it("rates a strong hook and payoff above rambling", () => {
    const strong = scoreCandidate(toSentences(speak(viral)), undefined);
    const weak = scoreCandidate(toSentences(speak(filler.slice(0, 5))), undefined);
    expect(overallScore(strong.scores)).toBeGreaterThan(overallScore(weak.scores) + 15);
    expect(strong.scores.hook).toBeGreaterThanOrEqual(80);
    expect(strong.reasons).toContain("Strong opening line");
  });
});

describe("findViralClips", () => {
  it("finds the punchy section inside a long ramble", () => {
    const words = [...speak(filler), ...speak(viral, 60), ...speak(filler, 90)];
    const clips = findViralClips("a", words, undefined, { minSeconds: 15, maxSeconds: 30, maxClips: 3 });
    expect(clips[0].start).toBeGreaterThanOrEqual(59);
    expect(clips[0].start).toBeLessThan(62);
    expect(clips[0].hook).toBe("Nobody tells you this about saving money in Lagos?");
    expect(clips.every((c) => c.end - c.start <= 31)).toBe(true);
    // No overlaps.
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    sorted.slice(1).forEach((c, i) => expect(c.start).toBeGreaterThanOrEqual(sorted[i].end));
  });

  it("builds a post kit from the clip's words", () => {
    const kit = localPostKit(toSentences(speak(viral)));
    expect(kit.title).toBe("Nobody tells you this about saving money in Lagos?");
    expect(kit.hashtags).toContain("#money");
    expect(kit.hashtags.slice(-2)).toEqual(["#reels", "#shorts"]);
  });
});

describe("findClipsByScene", () => {
  it("turns the most exciting scene into a clip card", async () => {
    const { findClipsByScene } = await import("./viral");
    const quiet = 120;
    const loud = 40;
    const bins = quiet + loud + quiet;
    const analysis = {
      loudness: Array.from({ length: bins }, (_, i) => (i >= quiet && i < quiet + loud ? -18 : -45 + (i % 7))),
      motion: Array.from({ length: bins }, (_, i) => (i >= quiet && i < quiet + loud ? 8 : 0.5)),
      cuts: Array(bins).fill(0),
      hasAudio: true,
    };
    const clips = findClipsByScene("a", bins / 2, analysis, { minSeconds: 15, maxSeconds: 25, maxClips: 2 });
    expect(clips[0].start).toBeGreaterThanOrEqual(50);
    expect(clips[0].end).toBeLessThanOrEqual(90);
    expect(clips[0].end - clips[0].start).toBeGreaterThanOrEqual(15);
    expect(clips[0].end - clips[0].start).toBeLessThanOrEqual(25);
    expect(clips[0].title).toMatch(/^Scene 1/);
    expect(clips[0].scores.emotion).toBeGreaterThan(80);
  });
});
