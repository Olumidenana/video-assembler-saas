import { chunkTransitions, outputDuration, outputStarts, overlaps } from "./transitions";
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

  it("evens out loudness to -14 LUFS after everything else", () => {
    const plain = buildReencodeArgs([item()], { width: 720, height: 1280, fps: 30 }, "/out.mp4", { normalize: true });
    const g1 = plain[plain.indexOf("-filter_complex") + 1];
    expect(g1).toContain("concat=n=1:v=1:a=1[vout][apre]");
    expect(g1).toMatch(/\[apre\]loudnorm=I=-14:TP=-1\.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo\[aout\]$/);
    const mixed = buildReencodeArgs([item()], { width: 720, height: 1280, fps: 30 }, "/out.mp4", {
      normalize: true,
      music: { path: "/music.wav", volume: 0.6, original: 1, duck: true },
    });
    const g2 = mixed[mixed.indexOf("-filter_complex") + 1];
    expect(g2).toContain("alimiter=limit=0.95,aformat=channel_layouts=stereo[apre]");
    expect(g2.split("[aout]")).toHaveLength(2);
  });

  it("cuts in with a white flash, then holds and dims the last frame for an end card", () => {
    const args = buildReencodeArgs([item({ start: 0, end: 2, flashIn: false }), item({ clipId: "b", start: 0, end: 10, flashIn: true })], { width: 720, height: 1280, fps: 30 }, "/out.mp4", {
      endCard: 1.6,
      progressBar: true,
      music: { path: "/music.wav", volume: 0.6, original: 1, duck: true },
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph.split("fade=t=in:st=0:d=0.3:color=white")).toHaveLength(2);
    expect(graph).toContain("[vcat]tpad=stop_mode=clone:stop_duration=1.600,drawbox=");
    expect(graph).toContain("enable='gte(t,12.000)'[vjoined]");
    expect(graph).toContain("[acat]apad=pad_dur=1.600[ajoined]");
    // The bar and the music run to the end of the card.
    expect(graph).toContain("d=13.600[barsrc]");
    expect(graph).toContain("atrim=end=13.600");
  });

  it("blends segments with transitions, overlapping them, and hard-cuts where there is none", () => {
    const items = [
      item({ start: 0, end: 4 }),
      item({ clipId: "b", start: 10, end: 16, transitionIn: { type: "fadewhite", duration: 0.25 } }),
      item({ start: 20, end: 25 }),
      item({ clipId: "b", start: 30, end: 31.2, transitionIn: { type: "fade", duration: 0.6 } }),
    ];
    expect(overlaps(items)).toEqual([0, 0.25, 0, 0.4]); // capped at a third of the 1.2 s segment
    expect(outputStarts(items)).toEqual([0, 3.75, 9.75, 14.35]);
    expect(outputDuration(items)).toBe(15.55);
    const args = buildReencodeArgs(items, { width: 720, height: 1280, fps: 30 }, "/out.mp4", { progressBar: true });
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Only the short overlapping pieces are blended; concat joins everything in order.
    expect(graph).toContain("[v0]split=2[v0b][v0t]");
    expect(graph).toContain("[v0t]trim=start=3.750:end=4.000,setpts=PTS-STARTPTS,fps=30[vt0]");
    expect(graph).toContain("[v1h]trim=start=0.000:end=0.250,setpts=PTS-STARTPTS,fps=30[vh1]");
    expect(graph).toContain("[vt0][vh1]xfade=transition=fadewhite:duration=0.217:offset=0[vT1]");
    expect(graph).toContain("[atf1][ahf1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aT1]");
    expect(graph).toContain("[v2]split=2[v2b][v2t]"); // a hard cut in, a transition out
    expect(graph).toContain("[vt2][vh3]xfade=transition=fade:duration=0.367:offset=0[vT3]");
    expect(graph).toContain("[vb0][ab0][vT1][aT1][vb1][ab1][vb2][ab2][vT3][aT3][vb3][ab3]concat=n=6:v=1:a=1[vjoined][aout]");
    expect(graph).toContain("d=15.550[barsrc]");
    expect(chooseMethod(items, { maxShortSide: Infinity, fastCut: true })).toBe("reencode");
  });

  it("renders long transition runs in chunks of three with the same timing", () => {
    const fade = { type: "fade" as const, duration: 0.6 };
    const items = [0, 1, 2, 3, 4, 5, 6].map((k) => item({ start: k * 10, end: k * 10 + (k === 3 ? 1.2 : 5), transitionIn: k ? fade : undefined }));
    const { chunks, joins } = chunkTransitions(items);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 1]);
    expect(chunks[1][0].transitionIn).toBeUndefined();
    // The join into chunk 2 keeps the overlap capped by the short 1.2 s segment, not the chunk's length.
    expect(joins).toEqual([undefined, { type: "fade", duration: 0.4 }, { type: "fade", duration: 0.6 }]);
    const joined = chunks.map((c, i) => ({ start: 0, end: outputDuration(c), transitionIn: joins[i] }));
    expect(outputDuration(joined)).toBeCloseTo(outputDuration(items), 3);
  });

  it("cuts beat edits on exact frames of one grid, with slow motion and on-the-beat effects", () => {
    const beat = 60 / 130;
    const items = [
      item({ start: 10, end: 10 + 4 * beat, fx: { dip: 0.3 } }),
      item({ clipId: "b", start: 50, end: 50 + beat, fx: { flash: 0.1, punch: true } }),
      item({ start: 80, end: 80 + beat, fx: { shake: true } }),
      item({ clipId: "b", start: 90, end: 90 + 2 * beat, speed: 0.5 }),
    ];
    expect(outputDuration(items)).toBeCloseTo(10 * beat, 3);
    const args = buildReencodeArgs(items, { width: 720, height: 1280, fps: 30 }, "/out.mp4", { frameExact: { origin: 0 } });
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Boundaries at 0, 4, 5, 6, 10 beats, each rounded to the nearest frame: 0, 55, 69, 83, 138.
    expect([...graph.matchAll(/trim=end_frame=(\d+)/g)].map((m) => Number(m[1]))).toEqual([55, 14, 14, 55]);
    expect(graph).toContain("fade=t=in:st=0:d=0.300:color=black");
    expect(graph).toContain("zoompan=z='max(1,1.25-it)'");
    expect(graph).toContain("fade=t=in:st=0:d=0.100:color=white");
    expect(graph).toContain("crop=720:1280:x='(iw-ow)/2*(1+sin(t*55)*max(0,1-t/0.35))'");
    expect(graph).toContain("setsar=1,setpts=(PTS-STARTPTS)/0.5,fps=30");
    expect(graph).toContain("atempo=0.5,apad,atrim=end=1.833");
    const dark = buildReencodeArgs([item({ fx: { dim: true } }), item({ clipId: "b", fx: { blackout: true } })], { width: 720, height: 1280, fps: 30 }, "/out.mp4");
    const gd = dark[dark.indexOf("-filter_complex") + 1];
    expect(gd).toContain("drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill");
    expect(gd).toContain("drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill");
    expect(gd).toMatch(/\[1:a:0\][^;]*volume=0,apad/);
    const zoomed = buildReencodeArgs([item({ fx: { zoom: 1.22 } })], { width: 720, height: 1280, fps: 30 }, "/out.mp4");
    expect(zoomed[zoomed.indexOf("-filter_complex") + 1]).toContain("scale=878:1562,crop=720:1280:(iw-ow)/2:(ih-oh)*0.35,setsar=1");
    // A chunk that starts later on the grid rounds against the same grid.
    const later = buildReencodeArgs(items.slice(1), { width: 720, height: 1280, fps: 30 }, "/out.mkv", { frameExact: { origin: 4 * beat }, intermediate: true });
    const g2 = later[later.indexOf("-filter_complex") + 1];
    expect([...g2.matchAll(/trim=end_frame=(\d+)/g)].map((m) => Number(m[1]))).toEqual([14, 14, 55]);
    expect(later).toContain("pcm_s16le");
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
