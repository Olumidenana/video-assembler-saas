import { describe, expect, it } from "vitest";
import {
  buildConcatList,
  buildReencodeArgs,
  canStreamCopy,
  computeCanvas,
  parseLogTime,
} from "./commands";
import { chooseMethod } from "./export";
import { parseProbe } from "./probe";
import { initialTimeline, MAX_PARTS, timelineReducer, type TimelineState } from "./timeline";
import type { Clip, ExportItem, MediaInfo } from "./types";

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  rotation: 0,
  videoCodec: "h264",
  videoProfile: "High",
  pixFmt: "yuv420p",
  audioCodec: "aac",
  audioSampleRate: 48000,
  audioChannels: 2,
  ...over,
});

const item = (over: Partial<ExportItem> = {}): ExportItem => ({
  clipId: "a",
  info: info(),
  start: 0,
  end: 10,
  ...over,
});

describe("parseProbe", () => {
  it("swaps dimensions for rotated phone video and reads audio", () => {
    const json = JSON.stringify({
      format: { duration: "5.000000" },
      streams: [
        {
          codec_type: "video", codec_name: "h264", profile: "High", pix_fmt: "yuv420p",
          width: 1920, height: 1080, avg_frame_rate: "30000/1001",
          side_data_list: [{ rotation: -90 }],
        },
        { codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2 },
      ],
    });
    const result = parseProbe(json);
    expect(result).toMatchObject({ width: 1080, height: 1920, rotation: 270, audioCodec: "aac", duration: 5 });
    expect(result.fps).toBeCloseTo(29.97, 2);
  });

  it("rejects audio-only files", () => {
    const json = JSON.stringify({ format: { duration: "3" }, streams: [{ codec_type: "audio" }] });
    expect(() => parseProbe(json)).toThrow(/No video stream/);
  });
});

describe("computeCanvas", () => {
  it("caps the short side at 720 for landscape and portrait", () => {
    expect(computeCanvas(info(), 720)).toEqual({ width: 1280, height: 720, fps: 30 });
    expect(computeCanvas(info({ width: 1080, height: 1920 }), 720)).toEqual({ width: 720, height: 1280, fps: 30 });
  });

  it("never upscales and keeps dimensions even", () => {
    expect(computeCanvas(info({ width: 641, height: 359 }), 720)).toMatchObject({ width: 642, height: 360 });
    expect(computeCanvas(info(), Infinity)).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("canStreamCopy / chooseMethod", () => {
  const opts = { maxShortSide: Infinity, fastCut: false };

  it("copies identical untrimmed clips", () => {
    const items = [item(), item({ clipId: "b" })];
    expect(canStreamCopy(items, Infinity)).toBe(true);
    expect(chooseMethod(items, opts)).toBe("copy");
  });

  it("re-encodes when a free-plan downscale is needed", () => {
    expect(chooseMethod([item()], { ...opts, maxShortSide: 720 })).toBe("reencode");
  });

  it("re-encodes mismatched or rotated sources", () => {
    expect(canStreamCopy([item(), item({ info: info({ fps: 25 }) })], Infinity)).toBe(false);
    expect(canStreamCopy([item(), item({ info: info({ audioCodec: null }) })], Infinity)).toBe(false);
    expect(canStreamCopy([item({ info: info({ rotation: 90 }) })], Infinity)).toBe(false);
    expect(canStreamCopy([item({ info: info({ videoCodec: "vp9" }) })], Infinity)).toBe(false);
  });

  it("only copies trimmed clips when fast cut is on", () => {
    const items = [item({ start: 2, end: 8 })];
    expect(chooseMethod(items, opts)).toBe("reencode");
    expect(chooseMethod(items, { ...opts, fastCut: true })).toBe("copy");
  });
});

describe("command builders", () => {
  it("writes inpoint/outpoint only for trimmed items", () => {
    expect(buildConcatList([item(), item({ clipId: "b", start: 1.5, end: 9 })])).toBe(
      "file '/in/a/source'\nfile '/in/b/source'\ninpoint 1.500\noutpoint 9.000",
    );
  });

  it("seeks each input and adds silence for clips without audio", () => {
    const args = buildReencodeArgs(
      [item({ start: 2, end: 5 }), item({ clipId: "b", info: info({ audioCodec: null }) })],
      { width: 1280, height: 720, fps: 30 },
      "/out.mp4",
    );
    expect(args.slice(0, 16)).toEqual([
      "-threads", "2", "-ss", "2.000", "-t", "3.000", "-i", "/in/a/source",
      "-threads", "2", "-ss", "0.000", "-t", "10.000", "-i", "/in/b/source",
    ]);
    // An explicit encoder thread count: x264's "auto" crashes the multi-threaded core.
    expect(args[args.indexOf("libx264") + 7]).toBe("-threads");
    expect(args[args.indexOf("libx264") + 8]).toBe("4");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:a:0]aresample=48000");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=end=10.000");
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]");
    expect(args.at(-1)).toBe("/out.mp4");
  });

  it("mixes music under the original sound, ducking it while people talk", () => {
    const args = buildReencodeArgs([item({ start: 0, end: 8 })], { width: 1280, height: 720, fps: 30 }, "/out.mp4", {
      logo: true,
      music: { path: "/music.wav", volume: 0.6, original: 0.9, duck: true },
    });
    // Inputs: clip 0, logo 1, music 2.
    expect(args.filter((a, i) => args[i - 1] === "-i")).toEqual(["/in/a/source", "/overlay-logo.png", "/music.wav"]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("concat=n=1:v=1:a=1[vjoined][ajoined]");
    expect(graph).toContain("[1:v]scale=");
    expect(graph).toContain("[2:a:0]aresample=48000");
    expect(graph).toContain("atrim=end=8.000");
    expect(graph).toContain("afade=t=out:st=6.500:d=1.50");
    expect(graph).toContain("volume=0.60[mus]");
    expect(graph).toContain("[ajoined]volume=0.90[orig]");
    expect(graph).toContain("sidechaincompress");
    expect(graph).toMatch(/amix=inputs=3[^;]*\[aout\]$/);
    expect(graph).toContain("[musdry]volume=0.45[musfloor]");
  });

  it("draws a progress bar that fills over the whole video", () => {
    const args = buildReencodeArgs([item({ start: 0, end: 4 }), item({ clipId: "b", start: 0, end: 6 })], { width: 720, height: 1280, fps: 30 }, "/out.mp4", {
      progressBar: true,
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("color=c=0x8b7bff:s=720x6:r=30:d=10.000[barsrc]");
    expect(graph).toContain("overlay=x='-W+W*t/10.000':y=H-h:eof_action=pass[vbar]");
    expect(graph).toContain("[vbar]null[vout]");
  });

  it("plays music alone when the original sound is off", () => {
    const args = buildReencodeArgs([item()], { width: 1280, height: 720, fps: 30 }, "/out.mp4", {
      music: { path: "/music.wav", volume: 1, original: 0, duck: true },
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("sidechaincompress");
    expect(graph).toContain("[1:a:0]aresample=48000");
  });

  it("parses progress times from FFmpeg logs", () => {
    expect(parseLogTime("frame=  90 fps=30 q=28.0 size=256kB time=00:01:02.50 bitrate=")).toBeCloseTo(62.5);
    expect(parseLogTime("Input #0, mov,mp4")).toBeNull();
  });
});

describe("timelineReducer", () => {
  const clip = (id: string, duration = 10): Clip => ({ id, file: new File([], `${id}.mp4`), url: "", info: info({ duration }) });
  const withClip = (duration = 10): TimelineState =>
    timelineReducer(initialTimeline, { type: "addClip", clip: clip("a", duration) });

  it("adds a full-length segment and selects it", () => {
    const s = withClip();
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toMatchObject({ clipId: "a", start: 0, end: 10 });
    expect(s.selectedId).toBe(s.segments[0].id);
  });

  it("splits at a point and ignores splits at the edges", () => {
    const s = withClip();
    const id = s.segments[0].id;
    const split = timelineReducer(s, { type: "split", id, at: 4 });
    expect(split.segments.map((x) => [x.start, x.end])).toEqual([[0, 4], [4, 10]]);
    expect(timelineReducer(s, { type: "split", id, at: 0.05 })).toEqual(s);
  });

  it("splits into equal parts and folds a tiny remainder", () => {
    const s = withClip(65.05);
    const parts = timelineReducer(s, { type: "splitEvery", id: s.segments[0].id, seconds: 30 }).segments;
    expect(parts.map((x) => [x.start, x.end])).toEqual([[0, 30], [30, 60], [60, 65.05]]);

    const tail = timelineReducer(withClip(60.05), { type: "splitEvery", id: withClip(60.05).segments[0].id, seconds: 30 });
    expect(tail.segments.at(-1)?.end).toBe(60.05);
  });

  it("caps the number of parts", () => {
    const s = withClip(10_000);
    const parts = timelineReducer(s, { type: "splitEvery", id: s.segments[0].id, seconds: 1 }).segments;
    expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);
  });

  it("clamps trims to a valid range", () => {
    const s = withClip();
    const id = s.segments[0].id;
    expect(timelineReducer(s, { type: "setRange", id, start: -5 }).segments[0].start).toBe(0);
    const pushed = timelineReducer(timelineReducer(s, { type: "setRange", id, end: 3 }), { type: "setRange", id, start: 5 });
    expect(pushed.segments[0]).toMatchObject({ start: 5, end: 5.1 });
  });

  it("drops a clip once its last segment is removed", () => {
    const s = withClip();
    const split = timelineReducer(s, { type: "split", id: s.segments[0].id, at: 5 });
    const one = timelineReducer(split, { type: "removeSegment", id: split.segments[0].id });
    expect(Object.keys(one.clips)).toEqual(["a"]);
    const none = timelineReducer(one, { type: "removeSegment", id: one.segments[0].id });
    expect(none).toEqual({ clips: {}, segments: [], selectedId: null });
  });

  it("replaces the edit list, clamping ranges and skipping unknown clips", () => {
    const s = timelineReducer(withClip(), {
      type: "replaceSegments",
      segments: [
        { clipId: "a", start: 1, end: 3 },
        { clipId: "zzz", start: 0, end: 1 },
        { clipId: "a", start: 8, end: 50 },
      ],
    });
    expect(s.segments.map((x) => [x.start, x.end])).toEqual([[1, 3], [8, 10]]);
    expect(s.selectedId).toBe(s.segments[0].id);
    expect(Object.keys(s.clips)).toEqual(["a"]);
  });

  it("reorders segments", () => {
    let s = withClip();
    s = timelineReducer(s, { type: "addClip", clip: clip("b") });
    s = timelineReducer(s, { type: "move", id: s.segments[1].id, delta: -1 });
    expect(s.segments.map((x) => x.clipId)).toEqual(["b", "a"]);
  });
});

describe("parallel analysis", () => {
  it("splits long videos into whole-second chunks and merges them back in order", async () => {
    const { analysisChunks, mergeAnalyses } = await import("./analysis");
    const chunks = analysisChunks(601.5, 2);
    expect(chunks).toEqual([
      { start: 0, duration: 301 },
      { start: 301, duration: 300.5 },
    ]);
    const part = (n: number, v: number) => ({ loudness: Array(n).fill(v), motion: Array(n).fill(v), cuts: Array(n).fill(0), hasAudio: true });
    // A chunk can come back with an extra trailing bin; it's dropped.
    const merged = mergeAnalyses([part(603, 1), part(601, 2)], chunks);
    expect(merged.motion).toHaveLength(1203);
    expect(merged.motion[601]).toBe(1);
    expect(merged.motion[602]).toBe(2);
  });

  it("uses more workers only on devices with the cores and memory for them", async () => {
    const { analysisWorkers } = await import("./engine");
    expect(analysisWorkers(4, 2)).toBe(1);
    expect(analysisWorkers(2, 8)).toBe(1);
    expect(analysisWorkers(4, 8)).toBe(2);
    expect(analysisWorkers(8, 8)).toBe(3);
    expect(analysisWorkers(16, 16)).toBe(4);
  });

  it("analyses a chunk with input seeking and decodes cheaply", async () => {
    const { buildAnalysisArgs } = await import("./analysis");
    const args = buildAnalysisArgs("a", info(), { start: 300, duration: 300 });
    expect(args.slice(0, 12)).toEqual(["-threads", "2", "-skip_loop_filter", "all", "-skip_frame", "noref", "-ss", "300.000", "-t", "300.000", "-i", "/in/a/source"]);
  });
});
