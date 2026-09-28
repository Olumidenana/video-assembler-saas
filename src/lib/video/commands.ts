import type { ExportItem, MediaInfo } from "./types";

/** Where a clip's file is mounted (read-only WORKERFS) inside the FFmpeg virtual FS. */
export const clipDir = (clipId: string) => `/in/${clipId}`;
export const clipPath = (clipId: string) => `${clipDir(clipId)}/source`;

/** Segments shorter than this are rejected; FFmpeg can't do much useful with them. */
export const MIN_SEGMENT_SECONDS = 0.1;
/** Trims within this distance of the clip's edges count as "untrimmed". */
const EDGE_TOLERANCE = 0.05;

/**
 * Thread limits for the multi-threaded core. libx264's automatic thread count
 * (1.5x CPU cores) crashes @ffmpeg/core-mt 0.12 above 5 threads, and every input
 * opens its own decoder threads up front, so we keep the total well inside the
 * core's fixed pthread pool. They are harmless on the single-threaded core.
 */
const ENCODER_THREADS = 4;
const FILTER_THREADS = 2;
const decoderThreads = (inputs: number) => (inputs <= 4 ? 2 : 1);

export interface Canvas {
  width: number;
  height: number;
  fps: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const secs = (n: number) => n.toFixed(3);

/** Output size: the source's display size, scaled down so the short side fits the plan. */
export function computeCanvas(info: MediaInfo, maxShortSide: number): Canvas {
  const scale = Math.min(1, maxShortSide / Math.min(info.width, info.height));
  return {
    width: even(info.width * scale),
    height: even(info.height * scale),
    fps: Math.min(60, Math.max(1, Math.round(info.fps) || 30)),
  };
}

export function needsDownscale(info: MediaInfo, maxShortSide: number): boolean {
  return Math.min(info.width, info.height) > maxShortSide;
}

export function isUntrimmed(item: ExportItem): boolean {
  return item.start <= EDGE_TOLERANCE && item.end >= item.info.duration - EDGE_TOLERANCE;
}

/**
 * Whether the items can be joined with `-c copy` (no re-encode). Requires every
 * source to have identical stream parameters in MP4-friendly codecs, and no
 * downscale for the plan. Rotated sources are excluded because the concat
 * demuxer doesn't reliably carry the rotation metadata through.
 */
export function canStreamCopy(items: ExportItem[], maxShortSide: number): boolean {
  if (items.length === 0) return false;
  const ref = items[0].info;
  return items.every(({ info }) => {
    if (info.videoCodec !== "h264" || info.rotation !== 0) return false;
    if (info.audioCodec !== null && info.audioCodec !== "aac") return false;
    if (needsDownscale(info, maxShortSide)) return false;
    return (
      info.videoCodec === ref.videoCodec &&
      info.videoProfile === ref.videoProfile &&
      info.pixFmt === ref.pixFmt &&
      info.width === ref.width &&
      info.height === ref.height &&
      Math.abs(info.fps - ref.fps) < 0.01 &&
      info.audioCodec === ref.audioCodec &&
      info.audioSampleRate === ref.audioSampleRate &&
      info.audioChannels === ref.audioChannels
    );
  });
}

/** Concat-demuxer list for a stream-copy export. Trim points snap to keyframes. */
export function buildConcatList(items: ExportItem[]): string {
  return items
    .map((item) => {
      const lines = [`file '${clipPath(item.clipId)}'`];
      if (!isUntrimmed(item)) {
        if (item.start > EDGE_TOLERANCE) lines.push(`inpoint ${secs(item.start)}`);
        if (item.end < item.info.duration - EDGE_TOLERANCE) lines.push(`outpoint ${secs(item.end)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

export function buildCopyArgs(listPath: string, output: string, hasAudio: boolean): string[] {
  return [
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-c", "copy", "-movflags", "+faststart", output,
  ];
}

/**
 * Frame-accurate trim + stitch with a full re-encode. Every segment is scaled
 * and letterboxed onto the same canvas, normalized to the same frame rate and
 * audio format, and given a silent track if it has no audio, so the concat
 * filter accepts clips from any source.
 */
export function buildReencodeArgs(items: ExportItem[], canvas: Canvas, output: string): string[] {
  const { width: W, height: H, fps } = canvas;
  const inputs: string[] = [];
  const filters: string[] = [];
  const pairs: string[] = [];

  items.forEach((item, i) => {
    const duration = secs(item.end - item.start);
    // Input seeking (-ss before -i) jumps close to the start point instead of
    // decoding from the beginning, and stays frame-accurate when re-encoding.
    inputs.push(
      "-threads", String(decoderThreads(items.length)),
      "-ss", secs(item.start), "-t", duration, "-i", clipPath(item.clipId),
    );

    filters.push(
      `[${i}:v:0]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
    );
    filters.push(
      item.info.audioCodec
        ? `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
            `apad,atrim=end=${duration},asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=end=${duration},asetpts=PTS-STARTPTS[a${i}]`,
    );
    pairs.push(`[v${i}][a${i}]`);
  });

  filters.push(`${pairs.join("")}concat=n=${items.length}:v=1:a=1[vout][aout]`);

  return [
    ...inputs,
    "-filter_complex_threads", String(FILTER_THREADS),
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-threads", String(ENCODER_THREADS),
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    output,
  ];
}

/** Parses the `time=HH:MM:SS.xx` field of an FFmpeg progress log line into seconds. */
export function parseLogTime(line: string): number | null {
  const m = /time=\s*(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return t >= 0 ? t : 0;
}
