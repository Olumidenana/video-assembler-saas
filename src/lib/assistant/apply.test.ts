import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "@/lib/video/analysis";
import { initialTimeline, timelineReducer } from "@/lib/video/timeline";
import type { Clip, MediaInfo } from "@/lib/video/types";
import { applyActions } from "./apply";

const info = (duration: number): MediaInfo => ({
  duration, width: 1280, height: 720, fps: 30, rotation: 0, videoCodec: "h264", videoProfile: "High",
  pixFmt: "yuv420p", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 2,
});
const clip = (id: string, duration: number): Clip => ({ id, file: new File([], `${id}.mp4`), url: "", info: info(duration) });

function timeline(...clips: Clip[]) {
  return clips.reduce((s, c) => timelineReducer(s, { type: "addClip", clip: c }), initialTimeline);
}

// 30 s: loud & moving at 10–15 s and 25–30 s.
function storyAnalysis(): ClipAnalysis {
  const bins = [...("q".repeat(20) + "L".repeat(10) + "q".repeat(20) + "L".repeat(10))];
  return {
    loudness: bins.map((b) => (b === "L" ? -20 : -65)),
    motion: bins.map((b) => (b === "L" ? 6 : 0.2)),
    cuts: bins.map(() => 0),
    hasAudio: true,
  };
}

const span = (ranges: { start: number; end: number }[]) => ranges.map((r) => [r.start, r.end]);

describe("applyActions", () => {
  it("builds a highlight reel from analysed clips", () => {
    const out = applyActions(timeline(clip("a", 30)), [{ type: "highlights", seconds: 10 }], new Map([["a", storyAnalysis()]]));
    expect(span(out)).toEqual([[10, 15], [25, 30]]);
  });

  it("searches the full videos for a new highlight, even after an earlier cut", () => {
    const cut = timelineReducer(timeline(clip("a", 30)), { type: "replaceSegments", segments: [{ clipId: "a", start: 25, end: 30 }] });
    const out = applyActions(cut, [{ type: "highlights", seconds: 10 }], new Map([["a", storyAnalysis()]]));
    expect(span(out)).toEqual([[10, 15], [25, 30]]);
  });

  it("chains silence removal, splitting and trimming", () => {
    const out = applyActions(
      timeline(clip("a", 30)),
      [
        { type: "remove_silence" },
        { type: "split_every", seconds: 2, segment: 1 },
        { type: "cut", segment: null, fromStart: 0, fromEnd: 1 },
      ],
      new Map([["a", storyAnalysis()]]),
    );
    expect(out[0]).toEqual({ clipId: "a", start: 9.75, end: 11.75 });
    expect(out.at(-1)).toEqual({ clipId: "a", start: 24.75, end: 29 });
  });

  it("moves, removes and resets segments", () => {
    const base = timeline(clip("a", 10), clip("b", 5), clip("c", 8));
    const moved = applyActions(base, [{ type: "move_segment", segment: 3, to: 1 }, { type: "remove_segment", segment: 2 }], new Map());
    expect(moved.map((r) => r.clipId)).toEqual(["c", "b"]);

    const reset = applyActions(base, [{ type: "remove_segment", segment: 1 }, { type: "reset" }], new Map());
    expect(reset.map((r) => [r.clipId, r.end])).toEqual([["a", 10], ["b", 5], ["c", 8]]);
  });

  it("keeps a range of a segment and ignores out-of-range segment numbers", () => {
    const out = applyActions(timeline(clip("a", 60)), [{ type: "keep_range", segment: 1, start: 12, end: 20 }, { type: "remove_segment", segment: 9 }], new Map());
    expect(span(out)).toEqual([[12, 20]]);
  });
});
