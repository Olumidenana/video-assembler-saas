import { clipPath } from "./commands";
import type { MediaInfo } from "./types";

/** Analysis resolution: one loudness and one motion value per half second. */
export const BIN_SECONDS = 0.5;
/** Loudness floor in dBFS; digital silence ("-inf") is reported as this. */
export const SILENCE_DB = -90;

export interface ClipAnalysis {
  /** Loudness per bin in dBFS (SILENCE_DB for silence or no audio). */
  loudness: number[];
  /** Average frame-to-frame pixel change per bin (signalstats YDIF, 0..255). */
  motion: number[];
  /** Largest scene-change score per bin, 0..1; high values mark hard cuts. */
  cuts: number[];
  hasAudio: boolean;
}

export const ANALYSIS_FILES = { video: "/analysis-video.txt", audio: "/analysis-audio.txt" };

/**
 * One decode pass that writes per-frame metadata to text files:
 * - video: downscaled to 96px at 4 fps; frame-to-frame luma difference
 *   (motion) and scene-change score (hard cuts);
 * - audio: mono 16 kHz, RMS level for each 0.5 s window.
 * Output goes to the null muxer, so nothing is encoded.
 */
export function buildAnalysisArgs(clipId: string, info: MediaInfo): string[] {
  const hasAudio = info.audioCodec !== null;
  const graph = [
    `[0:v:0]fps=4,scale=96:-2,select='gte(scene,0)',signalstats,metadata=print:file=${ANALYSIS_FILES.video}[v]`,
    ...(hasAudio
      ? [
          `[0:a:0]aresample=16000,aformat=channel_layouts=mono,asetnsamples=n=8000:p=0,` +
            `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${ANALYSIS_FILES.audio}[a]`,
        ]
      : []),
  ].join(";");

  return [
    "-threads", "2",
    "-i", clipPath(clipId),
    "-filter_complex_threads", "2",
    "-filter_complex", graph,
    "-map", "[v]",
    ...(hasAudio ? ["-map", "[a]"] : []),
    "-f", "null", "-",
  ];
}

/**
 * Parses `metadata=print` output, where each frame is a header line followed
 * by one `key=value` line per metadata entry:
 *   frame:12   pts:...   pts_time:3.0
 *   lavfi.scene_score=0.0123
 */
export function parseMetadataPrint(text: string, key: string): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = [];
  let time: number | null = null;
  for (const line of text.split("\n")) {
    const t = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (t) {
      time = Number(t[1]);
      continue;
    }
    if (time !== null && line.startsWith(`${key}=`)) {
      const raw = line.slice(key.length + 1).trim();
      const value = raw === "-inf" || raw === "nan" ? Number.NEGATIVE_INFINITY : Number(raw);
      points.push({ time, value });
    }
  }
  return points;
}

/** Averages timed points into fixed bins covering [0, duration). */
export function toBins(
  points: { time: number; value: number }[],
  duration: number,
  fill: number,
  map: (v: number) => number = (v) => v,
): number[] {
  const count = Math.max(1, Math.ceil(duration / BIN_SECONDS));
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  for (const { time, value } of points) {
    const i = Math.min(count - 1, Math.max(0, Math.floor(time / BIN_SECONDS)));
    sums[i] += map(value);
    counts[i] += 1;
  }
  return sums.map((sum, i) => (counts[i] ? sum / counts[i] : fill));
}

export function parseAnalysis(files: Record<string, string>, info: MediaInfo): ClipAnalysis {
  const video = files[ANALYSIS_FILES.video] ?? "";
  const clean = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);
  const motion = toBins(parseMetadataPrint(video, "lavfi.signalstats.YDIF"), info.duration, 0, clean);
  const cuts = maxBins(parseMetadataPrint(video, "lavfi.scene_score"), info.duration);
  const hasAudio = info.audioCodec !== null && Boolean(files[ANALYSIS_FILES.audio]);
  const loudness = hasAudio
    ? toBins(
        parseMetadataPrint(files[ANALYSIS_FILES.audio], "lavfi.astats.Overall.RMS_level"),
        info.duration,
        SILENCE_DB,
        (v) => (Number.isFinite(v) ? Math.max(SILENCE_DB, v) : SILENCE_DB),
      )
    : new Array<number>(motion.length).fill(SILENCE_DB);
  return { loudness, motion, cuts, hasAudio };
}

function maxBins(points: { time: number; value: number }[], duration: number): number[] {
  const bins = new Array<number>(Math.max(1, Math.ceil(duration / BIN_SECONDS))).fill(0);
  for (const { time, value } of points) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor(time / BIN_SECONDS)));
    if (Number.isFinite(value)) bins[i] = Math.max(bins[i], Math.min(1, value));
  }
  return bins;
}
