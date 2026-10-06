import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "@/lib/video/analysis";
import type { Word } from "@/lib/video/captions";
import { findCountdownMoments, planCountdown, planQuote, planTalkEdits } from "./talk-edit";
import type { ViralClip } from "./viral";

/** A podcast: steady speech, a sentence every 3 s; a few strong lines (questions, numbers, "you") among filler. */
function podcast(): { words: Word[]; analysis: ClipAnalysis } {
  const lines = [
    "So yeah we were just talking about the weekend and stuff.",
    "Nobody tells you this about money, why do you think you are still broke?",
    "Um I mean it was fine I guess.",
    "Here are 3 things that changed my life and you need to hear them.",
    "Okay let's move on to the next part of the show.",
    "The secret is simple: you stop waiting and you start doing it today.",
  ];
  const words: Word[] = [];
  let t = 0;
  for (let k = 0; k < 120; k++) {
    for (const w of lines[k % lines.length].split(" ")) {
      words.push({ text: w, start: t, end: t + 0.3 });
      t += 0.35;
    }
    t += 0.6;
  }
  const bins = Math.ceil(t / 0.5) + 2;
  return {
    words,
    analysis: { loudness: Array.from({ length: bins }, (_, i) => (i % 9 === 0 ? -45 : -22)), motion: Array(bins).fill(1), cuts: Array(bins).fill(0), hasAudio: true },
  };
}

const { words, analysis } = podcast();
const video = { clipId: "pod", name: "my_podcast_ep12.mp4", duration: 900, analysis, words };

describe("talking edits", () => {
  it("keeps a quote whole and switches between wide and punched-in on every bar, on whole frames", () => {
    const quote = { clipId: "pod", start: 100, end: 121.3, score: 90 } as ViralClip;
    const plan = planQuote(quote, "cinematic", 30);
    const bar = (60 / 90) * 4;
    expect(plan.shots[0].start).toBe(100);
    expect(plan.shots.at(-1)!.end).toBe(121.3);
    for (let i = 1; i < plan.shots.length; i++) {
      expect(plan.shots[i].start).toBe(plan.shots[i - 1].end); // the voice runs on without a gap
      expect(Math.abs((plan.shots[i].start - 100) * 30 - Math.round((plan.shots[i].start - 100) * 30))).toBeLessThan(0.05);
      expect(plan.shots[i].start - 100).toBeCloseTo(i * bar, 1);
    }
    expect(plan.shots.map((s) => Boolean(s.fx?.zoom))).toEqual(plan.shots.map((_, i) => i % 2 === 1));
    expect(plan.dropAt).toBeCloseTo(2 * bar, 1);
    expect(plan).toMatchObject({ captions: true, exact: true, mix: { original: 1, duck: true } });
  });

  it("counts down the best moments, weakest first, labelled #3 to #1", () => {
    const moments = findCountdownMoments([video]);
    expect(moments).toHaveLength(3);
    const plan = planCountdown([video])!;
    expect(plan.labels!.map((l) => l.text)).toEqual(["#3", "#2", "#1"]);
    expect(plan.shots.at(-1)!.start).toBe(Math.round(moments[0].start * 1000) / 1000);
    expect(plan.labels![1].start).toBeCloseTo(plan.shots[0].end - plan.shots[0].start, 3);
    expect(plan.title).toBe("Top 3 moments from my podcast ep12");
    for (const s of plan.shots) expect(s.end - s.start).toBeLessThanOrEqual(15.5);
  });

  it("offers quote edits and a countdown for a podcast", () => {
    const plans = planTalkEdits([video], 30);
    expect(plans.map((p) => p.format)).toEqual(["quote", "quote", "countdown"]);
    for (const p of plans.filter((x) => x.format === "quote")) {
      expect(p.length).toBeGreaterThanOrEqual(12);
      expect(p.length).toBeLessThanOrEqual(29);
    }
  });
});
