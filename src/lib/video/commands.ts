import { hasTransitions, outputDuration, outputStarts, overlaps, playLength } from "./transitions";
import type { ExportItem, MediaInfo, SegmentFx } from "./types";

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

export type Aspect = "original" | "9:16" | "1:1" | "16:9";
/** How a source fills a canvas of a different shape. */
export type Fit = "crop" | "blur";

const ASPECTS: Record<Exclude<Aspect, "original">, [number, number]> = { "9:16": [9, 16], "1:1": [1, 1], "16:9": [16, 9] };

/**
 * Output size. "original" keeps the source's display size, scaled down so the
 * short side fits the plan; other aspects target a 1080-wide short side (also
 * capped by the plan), e.g. 1080x1920 for 9:16 or 720x1280 on Free.
 */
export function computeCanvas(info: MediaInfo, maxShortSide: number, aspect: Aspect = "original"): Canvas {
  const fps = Math.min(60, Math.max(1, Math.round(info.fps) || 30));
  if (aspect === "original") {
    const scale = Math.min(1, maxShortSide / Math.min(info.width, info.height));
    return { width: even(info.width * scale), height: even(info.height * scale), fps };
  }
  const [aw, ah] = ASPECTS[aspect];
  const short = Math.min(1080, maxShortSide);
  return aw <= ah
    ? { width: even(short), height: even((short * ah) / aw), fps }
    : { width: even((short * aw) / ah), height: even(short), fps };
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
/** Files written into FFmpeg's filesystem before an export that uses overlays. */
export const OVERLAY_FILES = {
  font: "/fonts/Montserrat-ExtraBold.ttf",
  fontsDir: "/fonts",
  logo: "/overlay-logo.png",
  captions: "/captions.ass",
  music: "/music",
};

export interface Overlays {
  fit?: Fit;
  /** "Made with Anti-Timeout" in the corner (Free plan). */
  watermark?: boolean;
  /** Creator's logo (PNG at OVERLAY_FILES.logo) in the top-right corner. */
  logo?: boolean;
  /** Burned-in captions from the ASS file at OVERLAY_FILES.captions. */
  captions?: boolean;
  /** Background music from `path`, mixed under the original sound. */
  music?: MusicMix;
  /** A thin bar along the bottom that fills as the video plays (keeps people watching to the end). */
  progressBar?: boolean;
  /** Even out loudness to -14 LUFS, the level TikTok, Reels and Shorts play at. */
  normalize?: boolean;
  /** Seconds of end card: the last frame holds, dims, and the sound plays out under the call to action. */
  endCard?: number;
  /** A piece that will be re-encoded again (chunked transitions): higher quality, lossless sound, Matroska. */
  intermediate?: boolean;
  /**
   * Cut every segment on whole frames of one grid (beat-synced edits). `origin`
   * is where this render starts in the finished video, so chunks rendered
   * separately land on the same grid.
   */
  frameExact?: { origin: number };
}

export interface MusicMix {
  /** File written to FFmpeg's FS (WAV from the composer, or the user's own track). */
  path: string;
  /** Music level, 0..1. */
  volume: number;
  /** Original sound level, 0..1 (0 = music only). */
  original: number;
  /** Turn the music down while people talk (sidechain ducking). */
  duck: boolean;
}

interface FitExtras {
  /** Legacy flash cut after a cold open (0.3 s from white). */
  flashIn?: boolean;
  speed?: number;
  fx?: SegmentFx;
  /** Exact frame count to keep (beat-synced edits). */
  frames?: number;
}

/** The per-segment effects of a beat edit, applied after the segment is on the canvas. */
function effectFilters(W: number, H: number, fps: number, { flashIn, fx }: FitExtras): string {
  const out: string[] = [];
  if (fx?.zoom && fx.zoom > 1) {
    // Jump zoom (talking clips): closer on the upper middle, where the speaker's face usually is.
    out.push(`scale=${even(W * fx.zoom)}:${even(H * fx.zoom)},crop=${W}:${H}:(iw-ow)/2:(ih-oh)*0.35`);
  }
  // A flash cut: the segment fades in from white, the classic edit transition after a cold open.
  if (flashIn) out.push("fade=t=in:st=0:d=0.3:color=white");
  if (fx?.punch) {
    // Starts 25% zoomed in and snaps back to normal over the first quarter second.
    out.push(`zoompan=z='max(1,1.25-it)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=${fps}`);
  }
  if (fx?.shake) {
    // A little zoomed in, so the frame can move; the shake settles within a third of a second.
    const sw = even(W * 1.08);
    const sh = even(H * 1.08);
    out.push(
      `scale=${sw}:${sh},crop=${W}:${H}:x='(iw-ow)/2*(1+sin(t*55)*max(0,1-t/0.35))':y='(ih-oh)/2*(1+cos(t*47)*max(0,1-t/0.35))'`,
    );
  }
  if (fx?.flash) out.push(`fade=t=in:st=0:d=${secs(fx.flash)}:color=white`);
  if (fx?.dip) out.push(`fade=t=in:st=0:d=${secs(fx.dip)}:color=black`);
  // zoompan and scale+crop change the sample aspect ratio, which concat rejects.
  if (fx?.punch || fx?.shake || (fx?.zoom && fx.zoom > 1)) out.push("setsar=1");
  return out.map((f) => `,${f}`).join("");
}

/** Fits one input onto the canvas: letterbox, fill-and-crop, or fit over a blurred copy. */
function fitFilter(input: string, out: string, W: number, H: number, fps: number, fit: Fit | "letterbox", extras: FitExtras = {}): string {
  const speed = extras.speed && extras.speed !== 1 ? `setpts=(PTS-STARTPTS)/${extras.speed},` : "";
  const trim = extras.frames ? `,trim=end_frame=${extras.frames}` : "";
  const tail = `setsar=1,${speed}fps=${fps},format=yuv420p,setpts=PTS-STARTPTS${effectFilters(W, H, fps, extras)}${trim}[${out}]`;
  if (fit === "crop") {
    return `${input}scale=${W}:${H}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${W}:${H},${tail}`;
  }
  if (fit === "blur") {
    // Blur a small copy and scale it up: looks the same as blurring full size, at a fraction of the cost.
    const bw = even(W / 8);
    const bh = even(H / 8);
    return (
      `${input}split[${out}a][${out}b];` +
      `[${out}a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,scale=${W}:${H},setsar=1[${out}bg];` +
      `[${out}b]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[${out}fg];` +
      `[${out}bg][${out}fg]overlay=(W-w)/2:(H-h)/2,${tail}`
    );
  }
  return (
    `${input}scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,${tail}`
  );
}

/** Escapes text for FFmpeg's drawtext (inside a filtergraph). */
const drawtextEscape = (text: string) => text.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:");

export const WATERMARK_TEXT = "Made with Anti-Timeout";

export function buildReencodeArgs(items: ExportItem[], canvas: Canvas, output: string, overlays: Overlays = {}): string[] {
  const { width: W, height: H, fps } = canvas;
  const inputs: string[] = [];
  const filters: string[] = [];
  const pairs: string[] = [];

  const grid = overlays.frameExact;
  const starts = outputStarts(items);
  items.forEach((item, i) => {
    const speed = item.speed && item.speed > 0 ? item.speed : 1;
    const source = item.end - item.start;
    // Beat-synced edits: every cut is rounded to the frame nearest its beat on
    // one global grid, so cuts never drift off the music, however many there are.
    const frames = grid
      ? Math.max(1, Math.round((grid.origin + starts[i] + playLength(item)) * fps) - Math.round((grid.origin + starts[i]) * fps))
      : undefined;
    const duration = secs(frames ? frames / fps : source / speed);
    // Input seeking (-ss before -i) jumps close to the start point instead of
    // decoding from the beginning, and stays frame-accurate when re-encoding.
    // Exact cuts read a little extra, so there's always a frame to trim to.
    inputs.push(
      "-threads", String(decoderThreads(items.length)),
      "-ss", secs(item.start), "-t", secs(frames ? source + 0.2 : source), "-i", clipPath(item.clipId),
    );

    filters.push(fitFilter(`[${i}:v:0]`, `v${i}`, W, H, fps, overlays.fit ?? "letterbox", { flashIn: item.flashIn, speed, fx: item.fx, frames }));
    filters.push(
      item.info.audioCodec
        ? `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
            `${speed !== 1 ? `atempo=${speed},` : ""}apad,atrim=end=${duration},asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=end=${duration},asetpts=PTS-STARTPTS[a${i}]`,
    );
    pairs.push(`[v${i}][a${i}]`);
  });

  const endCard = overlays.endCard && overlays.endCard > 0 ? overlays.endCard : 0;
  const hasPost = overlays.watermark || overlays.logo || overlays.captions || overlays.progressBar || endCard > 0;
  const music = overlays.music;
  const clipsTotal = outputDuration(items);
  const vJoined = endCard ? "vcat" : hasPost ? "vjoined" : "vout";
  const aJoined = endCard ? "acat" : music ? "ajoined" : "aout";
  if (hasTransitions(items)) {
    // xfade over whole segments makes FFmpeg queue the next segment's frames
    // until the overlap (memory runs out in the browser). Instead each segment
    // is split into head | body | tail; a transition blends only the short
    // tail of one with the head of the next, and concat joins the pieces.
    const o = overlaps(items);
    const frame = 1 / fps;
    const pieces: string[] = [];
    items.forEach((item, i) => {
      const len = playLength(item);
      const dIn = o[i];
      const dOut = o[i + 1] ?? 0;
      const parts = [dIn > 0 && "h", "b", dOut > 0 && "t"].filter((x): x is string => Boolean(x));
      const range = (part: string) => (part === "h" ? [0, dIn] : part === "b" ? [dIn, len - dOut] : [len - dOut, len]);
      if (parts.length === 1) {
        filters.push(`[v${i}]null[vb${i}]`, `[a${i}]anull[ab${i}]`);
      } else {
        filters.push(`[v${i}]split=${parts.length}${parts.map((x) => `[v${i}${x}]`).join("")}`);
        filters.push(`[a${i}]asplit=${parts.length}${parts.map((x) => `[a${i}${x}]`).join("")}`);
        for (const x of parts) {
          const [from, to] = range(x);
          filters.push(
            // xfade needs a declared constant frame rate, which trim doesn't pass on.
            `[v${i}${x}]trim=start=${secs(from)}:end=${secs(to)},setpts=PTS-STARTPTS${x === "b" ? "" : `,fps=${fps}`}[v${x}${i}]`,
            `[a${i}${x}]atrim=start=${secs(from)}:end=${secs(to)},asetpts=PTS-STARTPTS[a${x}${i}]`,
          );
        }
      }
      const t = item.transitionIn;
      if (t && dIn > 0) {
        // A frame shorter than the pieces, so rounding never leaves xfade waiting on a missing frame.
        filters.push(
          `[vt${i - 1}][vh${i}]xfade=transition=${t.type}:duration=${secs(Math.max(frame, dIn - frame))}:offset=0[vT${i}]`,
          `[at${i - 1}]afade=t=out:st=0:d=${secs(dIn)}[atf${i}]`,
          `[ah${i}]afade=t=in:st=0:d=${secs(dIn)}[ahf${i}]`,
          `[atf${i}][ahf${i}]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aT${i}]`,
        );
        pieces.push(`[vT${i}][aT${i}]`);
      }
      pieces.push(`[vb${i}][ab${i}]`);
    });
    filters.push(`${pieces.join("")}concat=n=${pieces.length}:v=1:a=1[${vJoined}][${aJoined}]`);
  } else {
    filters.push(`${pairs.join("")}concat=n=${items.length}:v=1:a=1[${vJoined}][${aJoined}]`);
  }
  if (endCard) {
    // Hold the last frame and dim it; silence-pad the sound (music, if any, carries on over it).
    filters.push(
      `[vcat]tpad=stop_mode=clone:stop_duration=${secs(endCard)},` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill:enable='gte(t,${secs(clipsTotal)})'[vjoined]`,
      `[acat]apad=pad_dur=${secs(endCard)}[${music ? "ajoined" : "aout"}]`,
    );
  }
  // Extra inputs (logo, music) come after the clips, in the order they're added.
  let nextInput = items.length;

  // Overlays go on the joined video, in order: captions, logo, watermark.
  if (hasPost) {
    let current = "vjoined";
    const step = (filter: string, label: string) => {
      filters.push(`[${current}]${filter}[${label}]`);
      current = label;
    };
    if (overlays.captions) step(`subtitles=${OVERLAY_FILES.captions}:fontsdir=${OVERLAY_FILES.fontsDir}`, "vcap");
    if (overlays.logo) {
      inputs.push("-i", OVERLAY_FILES.logo);
      const logoInput = nextInput++;
      const size = Math.round(Math.min(W, H) * 0.16);
      filters.push(`[${logoInput}:v]scale=${size}:-1,format=rgba,colorchannelmixer=aa=0.9[logo]`);
      const margin = Math.round(Math.min(W, H) * 0.04);
      filters.push(`[${current}][logo]overlay=W-w-${margin}:${margin}[vlogo]`);
      current = "vlogo";
    }
    if (overlays.watermark) {
      const size = Math.max(14, Math.round(Math.min(W, H) * 0.032));
      const margin = Math.round(Math.min(W, H) * 0.035);
      step(
        `drawtext=fontfile=${OVERLAY_FILES.font}:text='${drawtextEscape(WATERMARK_TEXT)}':fontsize=${size}:` +
          `fontcolor=white@0.9:box=1:boxcolor=black@0.4:boxborderw=${Math.round(size * 0.45)}:` +
          `x=w-tw-${margin}:y=h-th-${margin}`,
        "vmark",
      );
    }
    if (overlays.progressBar) {
      // A bar the width of the frame slides in from the left over the whole video.
      const total = clipsTotal + endCard;
      const h = Math.max(4, Math.round(Math.min(W, H) * 0.008));
      filters.push(`color=c=0x8b7bff:s=${W}x${h}:r=${fps}:d=${secs(total)}[barsrc]`);
      filters.push(`[${current}][barsrc]overlay=x='-W+W*t/${secs(total)}':y=H-h:eof_action=pass[vbar]`);
      current = "vbar";
    }
    filters.push(`[${current}]null[vout]`);
  }

  if (music) {
    const total = secs(clipsTotal + endCard);
    inputs.push("-i", music.path);
    const musicInput = nextInput++;
    const fade = Math.min(1.5, Number(total) / 4).toFixed(2);
    filters.push(
      `[${musicInput}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `atrim=end=${total},asetpts=PTS-STARTPTS,afade=t=out:st=${(Number(total) - Number(fade)).toFixed(3)}:d=${fade},` +
        `volume=${music.volume.toFixed(2)}[mus]`,
      `[ajoined]volume=${music.original.toFixed(2)}[orig]`,
    );
    if (music.duck && music.original > 0) {
      // Duck on the speech band, and keep 45% of the music undocked so loud
      // scenes (fights, crowds) never bury it completely.
      filters.push(
        `[orig]asplit=2[origmix][origsc]`,
        `[origsc]highpass=f=250,lowpass=f=3500[origkey]`,
        `[mus]asplit=2[musin][musdry]`,
        `[musin]volume=0.55[muswet]`,
        `[muswet][origkey]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[musduck]`,
        `[musdry]volume=0.45[musfloor]`,
        `[origmix][musduck][musfloor]amix=inputs=3:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,aformat=channel_layouts=stereo[aout]`,
      );
    } else {
      filters.push(`[orig][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,aformat=channel_layouts=stereo[aout]`);
    }
  }

  if (overlays.normalize) {
    // Whatever produced the final audio now feeds the loudness normaliser instead.
    const i = filters.findIndex((f) => f.includes("[aout]"));
    filters[i] = filters[i].replace("[aout]", "[apre]");
    filters.push(`[apre]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[aout]`);
  }

  return [
    ...inputs,
    // The multi-threaded core has a fixed thread pool; with more inputs (each a
    // demuxer thread) slice-threaded filters (fade, xfade) exhaust it and hang.
    "-filter_complex_threads", String(items.length <= 3 ? FILTER_THREADS : 1),
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", overlays.intermediate ? "18" : "23", "-pix_fmt", "yuv420p",
    "-threads", String(ENCODER_THREADS),
    ...(overlays.intermediate ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
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
