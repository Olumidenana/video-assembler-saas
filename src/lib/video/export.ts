import {
  buildConcatList,
  buildCopyArgs,
  buildReencodeArgs,
  canStreamCopy,
  computeCanvas,
  isUntrimmed,
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
  onProgress?: (ratio: number) => void;
}

/** Which method an export of these items will use. */
export function chooseMethod(items: ExportItem[], { maxShortSide, fastCut }: ExportOptions): ExportMethod {
  if (!canStreamCopy(items, maxShortSide)) return "reencode";
  return fastCut || items.every(isUntrimmed) ? "copy" : "reencode";
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
          buildReencodeArgs(items, computeCanvas(items[0].info, options.maxShortSide), output),
          output,
          { totalDuration, onProgress },
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
