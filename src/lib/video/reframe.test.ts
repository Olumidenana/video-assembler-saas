import { describe, expect, it } from "vitest";
import { buildReencodeArgs } from "./commands";
import { cameraPath, cropXExpression } from "./reframe";
import type { ExportItem } from "./types";

describe("follow the speaker", () => {
  it("holds still through small movements and detector glitches", () => {
    const path = cameraPath([
      { t: 0, x: 0.3 },
      { t: 0.5, x: 0.33 },
      { t: 1, x: 0.9 }, // one bad detection
      { t: 1.5, x: 0.31 },
      { t: 2, x: null }, // looked away
      { t: 2.5, x: 0.29 },
    ]);
    expect(path).toHaveLength(1);
    expect(path[0].x).toBeCloseTo(0.31, 1);
  });

  it("cuts straight to a different person instead of panning across", () => {
    const path = cameraPath([
      { t: 0, x: 0.28 },
      { t: 0.5, x: 0.28 },
      { t: 1, x: 0.84 },
      { t: 1.5, x: 0.84 },
    ]);
    expect(path).toEqual([
      { t: 0, x: 0.28 },
      { t: 0.967, x: 0.28 },
      { t: 1, x: 0.84 },
    ]);
  });

  it("makes that cut on the shot change when it's known", () => {
    const path = cameraPath(
      [
        { t: 0, x: 0.28 },
        { t: 0.5, x: 0.28 },
        { t: 1, x: 0.84 },
        { t: 1.5, x: 0.84 },
      ],
      { cuts: [0.65] },
    );
    expect(path).toEqual([
      { t: 0, x: 0.28 },
      { t: 0.617, x: 0.28 },
      { t: 0.65, x: 0.84 },
    ]);
  });

  it("glides to a new speaker once they hold the shot", () => {
    const path = cameraPath([
      { t: 0, x: 0.3 },
      { t: 0.5, x: 0.3 },
      { t: 1, x: 0.3 },
      { t: 1.5, x: 0.48 },
      { t: 2, x: 0.5 },
      { t: 2.5, x: 0.49 },
    ]);
    // A 0.4 s glide that arrives as the new speaker is first seen.
    expect(path).toEqual([
      { t: 0, x: 0.3 },
      { t: 1.1, x: 0.3 },
      { t: 1.5, x: 0.48 },
    ]);
  });

  it("centers when no face is ever found", () => {
    expect(cameraPath([{ t: 0, x: null }])).toEqual([{ t: 0, x: 0.5 }]);
  });

  it("crops along the path, clamped to the frame", () => {
    expect(cropXExpression([{ t: 0, x: 0.3 }, { t: 1.5, x: 0.3 }, { t: 2, x: 0.7 }])).toBe(
      "clip(if(lt(t,1.500),0.3000*iw,if(lt(t,2.000),(0.3000+0.4000*(t-1.500)/0.500)*iw,0.7000*iw))-ow/2,0,iw-ow)",
    );
    const info = { duration: 60, width: 1920, height: 1080, fps: 30, rotation: 0, videoCodec: "h264", videoProfile: "High", pixFmt: "yuv420p", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 2 };
    const item: ExportItem = { clipId: "a", info, start: 0, end: 10, track: [{ t: 0, x: 0.3 }] };
    const args = buildReencodeArgs([item], { width: 720, height: 1280, fps: 30 }, "/o.mp4", { fit: "track" });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("crop=w='trunc(min(iw,ih*720/1280)/2)*2':h='trunc(ih/2)*2':x='clip(0.3000*iw-ow/2,0,iw-ow)':y=0,scale=720:1280");
    // Without a path it's a plain center crop.
    const plain = buildReencodeArgs([{ ...item, track: undefined }], { width: 720, height: 1280, fps: 30 }, "/o.mp4", { fit: "track" });
    expect(plain[plain.indexOf("-filter_complex") + 1]).toContain("force_original_aspect_ratio=increase:force_divisible_by=2,crop=720:1280");
  });
});
