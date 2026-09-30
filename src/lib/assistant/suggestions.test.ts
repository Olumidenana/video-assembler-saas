import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "@/lib/video/analysis";
import { buildSuggestions } from "./suggestions";

const analysis = (pattern: string): ClipAnalysis => ({
  loudness: [...pattern].map((b) => (b === "L" ? -20 : -65)),
  motion: [...pattern].map(() => 1),
  cuts: [...pattern].map(() => 0),
  hasAudio: true,
});

describe("buildSuggestions", () => {
  it("suggests removing silence, a highlight and Status parts for long talky footage", () => {
    // 90 s: talking with long pauses.
    const pattern = ("L".repeat(20) + "q".repeat(10)).repeat(6);
    const s = buildSuggestions({
      clips: [{ id: "a", duration: 90, width: 1080, height: 1920 }],
      segments: [{ clipId: "a", start: 0, end: 90 }],
      analyses: { a: analysis(pattern) },
    });
    expect(s.map((x) => x.id)).toEqual(["silence", "highlight", "split"]);
    expect(s[0].label).toMatch(/^Remove \d+s of silence$/);
    expect(s[1].label).toBe("Make a 30s highlight for Reels & Status");
    expect(s[2]).toMatchObject({ label: "Split into 2 parts of 60s for WhatsApp Status", mode: "parts" });
  });

  it("doesn't offer splitting when every segment is already short", () => {
    const s = buildSuggestions({
      clips: [{ id: "a", duration: 90, width: 1080, height: 1920 }],
      segments: [0, 15, 30, 45, 60, 75].map((start) => ({ clipId: "a", start, end: start + 11 })),
      analyses: { a: analysis("L".repeat(180)) },
    });
    expect(s.map((x) => x.id)).not.toContain("split");
  });

  it("stays quiet for a short, tight clip", () => {
    expect(
      buildSuggestions({
        clips: [{ id: "a", duration: 20, width: 1920, height: 1080 }],
        segments: [{ clipId: "a", start: 0, end: 20 }],
        analyses: { a: analysis("L".repeat(40)) },
      }),
    ).toEqual([]);
  });

  it("waits for analysis before offering a highlight", () => {
    const s = buildSuggestions({
      clips: [{ id: "a", duration: 50, width: 1920, height: 1080 }],
      segments: [{ clipId: "a", start: 0, end: 50 }],
      analyses: {},
    });
    expect(s.map((x) => x.id)).toEqual([]);
  });
});
