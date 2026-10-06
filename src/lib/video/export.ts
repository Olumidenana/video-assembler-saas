import {
  type Aspect,
  type Canvas,
  buildConcatList,
  buildCopyArgs,
  buildReencodeArgs,
  canStreamCopy,
  computeCanvas,
  type Fit,
  isUntrimmed,
  type MusicMix,
  OVERLAY_FILES,
} from "./commands";
import type { VideoEngine } from "./engine";
import { clipPath } from "./commands";
import { chunkTransitions, hasTransitions, MAX_TRANSITION_INPUTS, outputDuration } from "./transitions";
import type { ExportItem } from "./types";

export type ExportMethod = "copy" | "reencode";

export interface ExportResult {
  blob: Blob;
  name: string;
  method: ExportMethod;
}

export interface ExportOptions {
  maxShortSide: number;
  /** Allow stream copy even when trimmed (cuts snap to keyframes). */
  fastCut: boolean;
  aspect?: Aspect;
  fit?: Fit;
  /** "Made with Anti-Timeout" mark (Free plan). */
  watermark?: boolean;
  /** Creator's logo as PNG bytes (Studio). */
  logo?: Uint8Array | null;
  /** Builds the ASS captions for one render's items (in output time), or null for none. */
  captions?: (items: ExportItem[], canvas: Canvas) => string | null;
  /** A bar along the bottom that fills as the video plays. */
  progressBar?: boolean;
  /** Platform loudness (-14 LUFS). */
  normalize?: boolean;
  /** Seconds of end card after the clip (last frame held and dimmed). */
  endCard?: number;
  /** Background music for one render's items (composed to fit them), or null for none. */
  music?: (items: ExportItem[], duration: number) => Promise<MusicTrack | null>;
  onProgress?: (ratio: number) => void;
}

export interface MusicTrack extends Omit<MusicMix, "path"> {
  bytes: Uint8Array;
  /** File extension FFmpeg should see ("wav", "mp3", "m4a"…). */
  ext: string;
}

/** Overlays, reframing and music change the picture or sound, which stream copy can't do. */
const needsPixels = (o: ExportOptions) =>
  (o.aspect !== undefined && o.aspect !== "original") || Boolean(o.watermark) || Boolean(o.logo) || Boolean(o.captions) || Boolean(o.music) || Boolean(o.progressBar) || Boolean(o.normalize);

/** Which method an export of these items will use. */
export function chooseMethod(items: ExportItem[], options: ExportOptions): ExportMethod {
  if (needsPixels(options) || hasTransitions(items) || !canStreamCopy(items, options.maxShortSide)) return "reencode";
  return options.fastCut || items.every(isUntrimmed) ? "copy" : "reencode";
}

let fontsPromise: Promise<Record<string, Uint8Array>> | null = null;

/** The caption/watermark fonts, fetched once from /fonts and kept in memory. */
function loadFonts(): Promise<Record<string, Uint8Array>> {
  fontsPromise ??= Promise.all(
    ["Montserrat-ExtraBold.ttf", "Anton-Regular.ttf"].map(async (name) => {
      const res = await fetch(`/fonts/${name}`);
      if (!res.ok) throw new Error(`Couldn't load font ${name}`);
      return [`${OVERLAY_FILES.fontsDir}/${name}`, new Uint8Array(await res.arrayBuffer())] as const;
    }),
  ).then(Object.fromEntries);
  fontsPromise.catch(() => {
    fontsPromise = null;
  });
  return fontsPromise;
}

async function render(
  engine: VideoEngine,
  items: ExportItem[],
  name: string,
  options: ExportOptions,
  onProgress?: (ratio: number) => void,
): Promise<ExportResult> {
  const method = chooseMethod(items, options);
  const output = `/${name}`;
  const clipIds = [...new Set(items.map((i) => i.clipId))];
  const totalDuration = outputDuration(items);

  const canvas = computeCanvas(items[0].info, options.maxShortSide, options.aspect);
  const ass = method === "reencode" ? (options.captions?.(items, canvas) ?? null) : null;
  const overlayFiles: Record<string, string | Uint8Array> =
    method === "reencode" && (options.watermark || ass)
      ? { ...(await loadFonts()) }
      : {};
  if (ass) overlayFiles[OVERLAY_FILES.captions] = ass;
  if (method === "reencode" && options.logo) overlayFiles[OVERLAY_FILES.logo] = options.logo;
  const endCard = method === "reencode" ? (options.endCard ?? 0) : 0;
  const track = method === "reencode" && options.music ? await options.music(items, totalDuration + endCard) : null;
  const music: MusicMix | undefined = track
    ? { path: `${OVERLAY_FILES.music}.${track.ext}`, volume: track.volume, original: track.original, duck: track.duck }
    : undefined;
  if (track && music) overlayFiles[music.path] = track.bytes;

  // Long runs with transitions: render chunks of a few segments first (the
  // browser's FFmpeg deadlocks on bigger transition graphs), then join those.
  let renderItems = items;
  let mountIds = clipIds;
  if (method === "reencode" && hasTransitions(items) && items.length > MAX_TRANSITION_INPUTS) {
    const { chunks, joins } = chunkTransitions(items);
    const steps = chunks.length + 1.5; // the final pass carries the overlays and audio: weigh it more
    renderItems = [];
    for (const [c, chunk] of chunks.entries()) {
      const path = `/chunk-${c}.mkv`;
      const len = outputDuration(chunk);
      const piece = await engine.run(
        [...new Set(chunk.map((i) => i.clipId))],
        buildReencodeArgs(chunk, canvas, path, { fit: options.aspect && options.aspect !== "original" ? (options.fit ?? "crop") : undefined, intermediate: true }),
        path,
        { totalDuration: len, onProgress: (r) => onProgress?.((c + r) / steps) },
      );
      const id = `chunk${c}`;
      overlayFiles[clipPath(id)] = piece;
      renderItems.push({
        clipId: id,
        info: { ...items[0].info, duration: len, width: canvas.width, height: canvas.height, fps: canvas.fps, rotation: 0, videoCodec: "h264", audioCodec: "pcm_s16le", audioSampleRate: 48000, audioChannels: 2 },
        start: 0,
        end: len,
        transitionIn: joins[c],
      });
    }
    mountIds = [];
    const done = chunks.length / steps;
    const report = onProgress;
    onProgress = report && ((r: number) => report(done + r * (1 - done)));
  }

  const bytes =
    method === "copy"
      ? await engine.run(
          clipIds,
          buildCopyArgs("/list.txt", output, items[0].info.audioCodec !== null),
          output,
          { totalDuration, onProgress },
          { "/list.txt": buildConcatList(items) },
        )
      : await engine.run(
          mountIds,
          buildReencodeArgs(renderItems, canvas, output, {
            // Chunks already have the canvas size and framing.
            fit: renderItems !== items ? undefined : options.aspect && options.aspect !== "original" ? (options.fit ?? "crop") : undefined,
            watermark: options.watermark,
            logo: Boolean(options.logo),
            captions: Boolean(ass),
            music,
            progressBar: options.progressBar,
            normalize: options.normalize,
            endCard,
          }),
          output,
          { totalDuration: totalDuration + endCard, onProgress },
          overlayFiles,
        );

  // Copy into a fresh ArrayBuffer-backed view so Blob accepts it under strict TS lib types.
  return { blob: new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), name, method };
}

/** Joins all items, in order, into one MP4. */
export function exportStitched(engine: VideoEngine, items: ExportItem[], options: ExportOptions) {
  return render(engine, items, "stitched.mp4", options, options.onProgress);
}

/**
 * Renders each item as its own MP4, one after another. An entry can be a
 * group of items joined into one part (e.g. a flash-forward intro + the clip).
 */
export async function exportParts(
  engine: VideoEngine,
  items: (ExportItem | ExportItem[])[],
  options: ExportOptions,
  onPart?: (result: ExportResult, index: number) => void,
): Promise<ExportResult[]> {
  const results: ExportResult[] = [];
  const pad = String(items.length).length;
  for (const [i, item] of items.entries()) {
    const name = `part-${String(i + 1).padStart(Math.max(2, pad), "0")}.mp4`;
    const result = await render(engine, Array.isArray(item) ? item : [item], name, options, (r) =>
      options.onProgress?.((i + r) / items.length),
    );
    results.push(result);
    onPart?.(result, i);
  }
  return results;
}
