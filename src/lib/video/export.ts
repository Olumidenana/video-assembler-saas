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
  (o.aspect !== undefined && o.aspect !== "original") || Boolean(o.watermark) || Boolean(o.logo) || Boolean(o.captions) || Boolean(o.music) || Boolean(o.progressBar);

/** Which method an export of these items will use. */
export function chooseMethod(items: ExportItem[], options: ExportOptions): ExportMethod {
  if (needsPixels(options) || !canStreamCopy(items, options.maxShortSide)) return "reencode";
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
  const totalDuration = items.reduce((sum, i) => sum + (i.end - i.start), 0);

  const canvas = computeCanvas(items[0].info, options.maxShortSide, options.aspect);
  const ass = method === "reencode" ? (options.captions?.(items, canvas) ?? null) : null;
  const overlayFiles: Record<string, string | Uint8Array> =
    method === "reencode" && (options.watermark || ass)
      ? { ...(await loadFonts()) }
      : {};
  if (ass) overlayFiles[OVERLAY_FILES.captions] = ass;
  if (method === "reencode" && options.logo) overlayFiles[OVERLAY_FILES.logo] = options.logo;
  const track = method === "reencode" && options.music ? await options.music(items, totalDuration) : null;
  const music: MusicMix | undefined = track
    ? { path: `${OVERLAY_FILES.music}.${track.ext}`, volume: track.volume, original: track.original, duck: track.duck }
    : undefined;
  if (track && music) overlayFiles[music.path] = track.bytes;

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
          clipIds,
          buildReencodeArgs(items, canvas, output, {
            fit: options.aspect && options.aspect !== "original" ? (options.fit ?? "crop") : undefined,
            watermark: options.watermark,
            logo: Boolean(options.logo),
            captions: Boolean(ass),
            music,
            progressBar: options.progressBar,
          }),
          output,
          { totalDuration, onProgress },
          overlayFiles,
        );

  // Copy into a fresh ArrayBuffer-backed view so Blob accepts it under strict TS lib types.
  return { blob: new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), name, method };
}

/** Joins all items, in order, into one MP4. */
export function exportStitched(engine: VideoEngine, items: ExportItem[], options: ExportOptions) {
  return render(engine, items, "stitched.mp4", options, options.onProgress);
}

/** Renders each item as its own MP4, one after another. */
export async function exportParts(
  engine: VideoEngine,
  items: ExportItem[],
  options: ExportOptions,
  onPart?: (result: ExportResult, index: number) => void,
): Promise<ExportResult[]> {
  const results: ExportResult[] = [];
  const pad = String(items.length).length;
  for (const [i, item] of items.entries()) {
    const name = `part-${String(i + 1).padStart(Math.max(2, pad), "0")}.mp4`;
    const result = await render(engine, [item], name, options, (r) =>
      options.onProgress?.((i + r) / items.length),
    );
    results.push(result);
    onPart?.(result, i);
  }
  return results;
}
