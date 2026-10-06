import { describe, expect, it } from "vitest";
import { assTime, buildAss, groupWords, wordsForOutput, type Word } from "./captions";
import type { ExportItem, MediaInfo } from "./types";

const info = { duration: 60 } as MediaInfo;
const words = (list: [string, number, number][]): Word[] => list.map(([text, start, end]) => ({ text, start, end }));

describe("captions", () => {
  it("formats ASS timestamps", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(3725.456)).toBe("1:02:05.46");
  });

  it("maps words onto the edited timeline and applies the free limit", () => {
    const items: ExportItem[] = [
      { clipId: "a", info, start: 10, end: 20 },
      { clipId: "b", info, start: 0, end: 5 },
    ];
    const transcripts = {
      a: words([["skip", 2, 3], ["hello", 10.2, 10.6], ["world", 19.5, 20.5]]),
      b: words([["again", 1, 1.4], ["late", 4, 4.5]]),
    };
    expect(wordsForOutput(items, transcripts).map((w) => [w.text, +w.start.toFixed(2)])).toEqual([
      ["hello", 0.2],
      ["world", 9.5],
      ["again", 11],
      ["late", 14],
    ]);
    expect(wordsForOutput(items, transcripts, 12).map((w) => w.text)).toEqual(["hello", "world", "again"]);
  });

  it("breaks lines on sentence ends, pauses and length", () => {
    const groups = groupWords(
      words([["So", 0, 0.2], ["this", 0.2, 0.4], ["works.", 0.4, 0.8], ["Now", 0.9, 1], ["later", 3, 3.4]]),
      5,
      30,
    );
    expect(groups.map((g) => g.map((w) => w.text).join(" "))).toEqual(["So this works.", "Now", "later"]);
  });

  it("builds a valid ASS script for each style", () => {
    const w = words([["Stop", 0, 0.4], ["scrolling", 0.4, 0.9], ["right", 0.9, 1.2], ["now!", 1.2, 1.6]]);
    const canvas = { width: 1080, height: 1920, fps: 30 };
    const pop = buildAss(w, "bold-pop", canvas);
    expect(pop).toContain("PlayResX: 1080");
    expect(pop).toContain("Style: Cap,Anton,");
    expect(pop).toContain("{\\c&H0000E5FF\\fscx108\\fscy108}STOP{\\c&H00FFFFFF\\fscx100\\fscy100} SCROLLING\n");
    expect(pop).toContain(",Cap,,0,0,0,,RIGHT {\\c&H0000E5FF\\fscx108\\fscy108}NOW!");
    expect(buildAss(w, "karaoke", canvas)).toContain("{\\kf40}Stop {\\kf50}scrolling");
    expect(buildAss(w, "clean", canvas)).toContain(",Cap,,0,0,0,,Stop scrolling right now!");
  });

  it("strips characters that would break ASS markup", () => {
    expect(buildAss(words([["{\\evil}", 0, 1]]), "clean", { width: 640, height: 360, fps: 30 })).toContain(",,evil");
  });
});

describe("hook title", () => {
  const canvas = { width: 720, height: 1280, fps: 30 };

  it("adds a top-centred hook for the opening seconds, even without captions", () => {
    const ass = buildAss([], "clean", canvas, { hook: { text: "He didn't see this {coming}", seconds: 3 } });
    expect(ass).toContain("Style: Hook,Anton,");
    expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:03\.00,Hook,,0,0,0,,\{[^}]*\}He didn't see this coming/);
  });

  it("leaves the hook out when there's no text", () => {
    expect(buildAss([], "clean", canvas, { hook: { text: "  ", seconds: 3 } })).not.toContain("Dialogue: 1,");
  });
});

describe("outro", () => {
  it("adds a call to action over the last seconds, and the hook pops in", () => {
    const ass = buildAss([], "clean", { width: 720, height: 1280, fps: 30 }, {
      hook: { text: "Wait for the last 3 seconds", seconds: 3 },
      outro: { text: "Follow for part 2", start: 28.4, end: 30 },
    });
    expect(ass).toContain("Style: Outro,Anton,");
    expect(ass).toContain("Dialogue: 1,0:00:28.40,0:00:30.00,Outro,,0,0,0,,");
    expect(ass).toContain("Follow for part 2");
    expect(ass).toMatch(/Hook,,0,0,0,,\{\\fad\(60,250\)\\fscx70\\fscy70\\t\(0,180,/);
  });
});

describe("part badge", () => {
  it("labels the part top-left until the clip ends", () => {
    const ass = buildAss([], "clean", { width: 720, height: 1280, fps: 30 }, { badge: { text: "PART 2", end: 30 } });
    expect(ass).toContain("Style: Badge,Montserrat ExtraBold,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:30.00,Badge,,0,0,0,,PART 2");
  });
});
