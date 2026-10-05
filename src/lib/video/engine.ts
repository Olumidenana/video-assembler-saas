import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { ANALYSIS_FILES, analysisChunks, buildAnalysisArgs, mergeAnalyses, parseAnalysis, type ClipAnalysis } from "./analysis";
import { clipDir, clipPath, parseLogTime } from "./commands";
import { parseProbe } from "./probe";
import type { MediaInfo } from "./types";

export type EngineMode = "multi-threaded" | "single-threaded";

export interface RunOptions {
  /** Expected output duration in seconds, used to turn log timestamps into progress. */
  totalDuration: number;
  /** 0..1 */
  onProgress?: (ratio: number) => void;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
  }
}

/** FFmpeg ran but exited with an error (bad input, unsupported codec, ...). */
export class FFmpegExitError extends Error {}

/** The file isn't a readable video. */
export class MediaError extends Error {}

/** The worker crashed, ran out of memory or stopped responding. It is restarted on next use. */
export class EngineCrashedError extends Error {
  constructor() {
    super("The video engine crashed");
  }
}

const LOG_TAIL = 30;
/** FFmpeg logs progress about twice a second; this much silence means the worker is stuck. */
const STALL_MS = 60_000;
/** Videos longer than this are analysed in parallel chunks when the device can afford it. */
const PARALLEL_MIN_SECONDS = 120;

/**
 * How many FFmpeg instances to analyse with at once. Each uses ~2 cores and a
 * few hundred MB, so phones and small laptops stay at one.
 */
export function analysisWorkers(cores = globalThis.navigator?.hardwareConcurrency ?? 2, memoryGb = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? 4): number {
  if (memoryGb < 4) return 1;
  if (cores >= 12 && memoryGb >= 8) return 4;
  if (cores >= 8) return 3;
  if (cores >= 4) return 2;
  return 1;
}

/**
 * Owns the single FFmpeg.wasm worker for the page.
 *
 * - Picks the multi-threaded core when the page is cross-origin isolated, else the
 *   single-threaded one.
 * - Mounts user files with WORKERFS, so FFmpeg reads them straight from the File
 *   object instead of copying gigabytes into wasm memory.
 * - Serializes all operations: the worker can only run one command at a time.
 * - cancel() terminates the worker (the only way to stop a running command); the
 *   next operation reloads it and re-mounts files transparently.
 */
export class VideoEngine {
  readonly mode: EngineMode;
  private ffmpeg: Promise<FFmpeg> | null = null;
  private mounted = new Set<string>();
  private files = new Map<string, File>();
  private queue: Promise<unknown> = Promise.resolve();
  private logListeners = new Set<(line: string) => void>();
  private timeListeners = new Set<(seconds: number) => void>();
  private generation = 0;
  /** Extra engines running parallel analysis; cancelled with this one. */
  private helpers: VideoEngine[] = [];

  constructor() {
    this.mode = globalThis.crossOriginIsolated ? "multi-threaded" : "single-threaded";
  }

  onLog(listener: (line: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  /** Starts downloading and initializing the core. Safe to call repeatedly. */
  load(): Promise<FFmpeg> {
    this.ffmpeg ??= this.createInstance().catch((err) => {
      this.ffmpeg = null;
      throw err;
    });
    return this.ffmpeg;
  }

  private async createInstance(): Promise<FFmpeg> {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => this.logListeners.forEach((l) => l(message)));
    // FFmpeg's own stats lines end in "\r" and only reach the log when the command
    // finishes, so live progress comes from this event instead. `time` is the
    // output timestamp in microseconds.
    ffmpeg.on("progress", ({ time }) => {
      if (time > 0) this.timeListeners.forEach((l) => l(time / 1_000_000));
    });

    const base = `${window.location.origin}/ffmpeg`;
    const core = this.mode === "multi-threaded" ? "mt" : "st";
    await ffmpeg.load({
      classWorkerURL: `${base}/class/worker.js`,
      coreURL: `${base}/${core}/ffmpeg-core.js`,
      wasmURL: `${base}/${core}/ffmpeg-core.wasm`,
      ...(core === "mt" ? { workerURL: `${base}/mt/ffmpeg-core.worker.js` } : {}),
    });
    await ffmpeg.createDir("/in");
    return ffmpeg;
  }

  /** Registers a file and returns its metadata. */
  addClip(clipId: string, file: File): Promise<MediaInfo> {
    this.files.set(clipId, file);
    return this.enqueue(async (ffmpeg) => {
      const out = `/probe-${clipId}.json`;
      await ffmpeg.ffprobe([
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
        clipPath(clipId), "-o", out,
      ]);
      let json: string;
      try {
        json = (await ffmpeg.readFile(out, "utf8")) as string;
      } catch {
        throw new MediaError("This file couldn't be read. Try MP4, MOV or WebM.");
      } finally {
        await ffmpeg.deleteFile(out).catch(() => {});
      }
      try {
        return parseProbe(json);
      } catch (err) {
        throw new MediaError(err instanceof Error ? err.message : "This file couldn't be read.");
      }
    }, [clipId]);
  }

  removeClip(clipId: string): Promise<void> {
    this.files.delete(clipId);
    return this.enqueue(async (ffmpeg) => {
      if (!this.mounted.delete(clipId)) return;
      await ffmpeg.unmount(clipDir(clipId));
      await ffmpeg.deleteDir(clipDir(clipId));
    });
  }

  /**
   * Runs an FFmpeg command against mounted clips and returns the output file's
   * bytes. `files` are extra text files written to the FS first (e.g. concat lists).
   */
  run(
    clipIds: string[],
    args: string[],
    output: string,
    options: RunOptions,
    files: Record<string, string | Uint8Array> = {},
  ): Promise<Uint8Array> {
    return this.execute(clipIds, args, options, files, [output], async (ffmpeg) => {
      return (await ffmpeg.readFile(output)) as Uint8Array;
    });
  }

  /**
   * Runs a command whose useful output is text files (e.g. per-frame metadata
   * written by the `metadata`/`ametadata` filters) and returns their contents.
   * Missing files come back as empty strings.
   */
  runForText(clipIds: string[], args: string[], outputs: string[], options: RunOptions): Promise<Record<string, string>> {
    return this.execute(clipIds, args, options, {}, outputs, async (ffmpeg) => {
      const result: Record<string, string> = {};
      for (const path of outputs) {
        result[path] = (await ffmpeg.readFile(path, "utf8").catch(() => "")) as string;
      }
      return result;
    });
  }

  private execute<T>(
    clipIds: string[],
    args: string[],
    { totalDuration, onProgress }: RunOptions,
    files: Record<string, string | Uint8Array>,
    outputs: string[],
    collect: (ffmpeg: FFmpeg) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async (ffmpeg) => {
      const tail: string[] = [];
      let lastOutput = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastOutput > STALL_MS) this.discardInstance();
      }, 5_000);
      const report = (t: number) => {
        lastOutput = Date.now();
        if (totalDuration > 0) onProgress?.(Math.min(1, t / totalDuration));
      };
      const offLog = this.onLog((line) => {
        lastOutput = Date.now();
        tail.push(line);
        if (tail.length > LOG_TAIL) tail.shift();
        const t = parseLogTime(line);
        if (t !== null) report(t);
      });
      this.timeListeners.add(report);
      try {
        for (const [path, data] of Object.entries(files)) {
          const dir = path.slice(0, path.lastIndexOf("/"));
          if (dir) await ffmpeg.createDir(dir).catch(() => {}); // Already exists is fine.
          // writeFile transfers the buffer to the worker, so pass a copy: callers cache these (fonts, logo).
          await ffmpeg.writeFile(path, typeof data === "string" ? data : data.slice());
        }
        const code = await ffmpeg.exec(args);
        if (code !== 0) {
          throw new FFmpegExitError(`FFmpeg failed (exit ${code}).\n${tail.join("\n")}`);
        }
        onProgress?.(1);
        return await collect(ffmpeg);
      } finally {
        clearInterval(watchdog);
        offLog();
        this.timeListeners.delete(report);
        for (const path of [...outputs, ...Object.keys(files)]) {
          await ffmpeg.deleteFile(path).catch(() => {});
        }
      }
    }, clipIds);
  }

  /** Measures loudness and motion across a clip (for auto-edit). */
  /**
   * Measures loudness (and, at "full", motion and cuts) across a clip.
   * `background` runs it entirely on helper engines, so this engine's queue
   * stays free for exports and transcription while it works.
   */
  async analyze(
    clipId: string,
    info: MediaInfo,
    onProgress?: (ratio: number) => void,
    level: "audio" | "full" = "full",
    { background = false }: { background?: boolean } = {},
  ): Promise<ClipAnalysis> {
    const audioOnly = level === "audio" && info.audioCodec !== null;
    const workers = audioOnly || this.mode !== "multi-threaded" || info.duration <= PARALLEL_MIN_SECONDS ? 1 : analysisWorkers();
    if (workers > 1 || background) {
      try {
        return await this.analyzeOnHelpers(clipId, info, Math.max(1, workers), onProgress, audioOnly ? "audio" : "full", background);
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        // Out of memory or a helper crashed: this engine alone is slower but reliable.
      }
    }
    return this.analyzeRange(clipId, info, undefined, onProgress, audioOnly ? "audio" : "full");
  }

  private async analyzeRange(
    clipId: string,
    info: MediaInfo,
    range: { start: number; duration: number } | undefined,
    onProgress?: (ratio: number) => void,
    level: "audio" | "full" = "full",
  ): Promise<ClipAnalysis> {
    const duration = range?.duration ?? info.duration;
    const files = await this.runForText(clipId ? [clipId] : [], buildAnalysisArgs(clipId, info, range, level), Object.values(ANALYSIS_FILES), {
      totalDuration: duration,
      onProgress,
    });
    return parseAnalysis(files, { ...info, duration });
  }

  /**
   * Splits the video into chunks analysed at the same time by short-lived
   * helper engines (each its own worker, so they really run in parallel), plus
   * this one unless running in the background. Helpers are shut down
   * afterwards to free memory.
   */
  private async analyzeOnHelpers(
    clipId: string,
    info: MediaInfo,
    workers: number,
    onProgress: ((ratio: number) => void) | undefined,
    level: "audio" | "full",
    background: boolean,
  ): Promise<ClipAnalysis> {
    const file = this.files.get(clipId);
    if (!file) throw new Error("Clip was removed.");
    const chunks = analysisChunks(info.duration, workers);
    // In the foreground this engine takes the first chunk; in the background it takes none.
    const helpers = chunks.slice(background ? 0 : 1).map(() => {
      const helper = new VideoEngine();
      helper.files.set(clipId, file);
      return helper;
    });
    this.helpers.push(...helpers);
    const progress = chunks.map(() => 0);
    const report = (i: number) => (r: number) => {
      progress[i] = r;
      onProgress?.(progress.reduce((s, p, k) => s + p * chunks[k].duration, 0) / info.duration);
    };
    try {
      const parts = await Promise.all(
        chunks.map((chunk, i) => {
          const engine = background ? helpers[i] : i === 0 ? this : helpers[i - 1];
          return engine.analyzeRange(clipId, info, chunks.length > 1 ? chunk : undefined, report(i), level);
        }),
      );
      return mergeAnalyses(parts, chunks);
    } finally {
      for (const helper of helpers) helper.cancel();
      this.helpers = this.helpers.filter((h) => !helpers.includes(h));
    }
  }

  /** Decodes part of a clip's audio as 16 kHz mono float samples (speech recognition input). */
  async extractAudio(clipId: string, start: number, duration: number): Promise<Float32Array> {
    const out = "/speech.f32";
    const bytes = await this.run(
      [clipId],
      [
        "-ss", start.toFixed(3), "-t", duration.toFixed(3), "-i", clipPath(clipId),
        "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-c:a", "pcm_f32le", out,
      ],
      out,
      { totalDuration: duration },
    );
    // Copy into an aligned buffer (it's transferred to the speech worker).
    const aligned = new Uint8Array(bytes.byteLength - (bytes.byteLength % 4));
    aligned.set(bytes.subarray(0, aligned.byteLength));
    return new Float32Array(aligned.buffer);
  }

  /** Stops whatever is running. Queued operations fail with CancelledError. */
  cancel(): void {
    this.generation++;
    this.queue = Promise.resolve();
    this.discardInstance();
    for (const helper of this.helpers) helper.cancel();
    this.helpers = [];
  }

  /** Kills the worker; the next operation starts a fresh one and re-mounts files. */
  private discardInstance(): void {
    const current = this.ffmpeg;
    this.ffmpeg = null;
    this.mounted.clear();
    void current?.then((f) => f.terminate()).catch(() => {});
  }

  private enqueue<T>(task: (ffmpeg: FFmpeg) => Promise<T>, clipIds: string[] = []): Promise<T> {
    const generation = this.generation;
    const run = async () => {
      if (generation !== this.generation) throw new CancelledError();
      const ffmpeg = await this.load();
      for (const id of clipIds) await this.mount(ffmpeg, id);
      try {
        return await task(ffmpeg);
      } catch (err) {
        if (generation !== this.generation) throw new CancelledError();
        if (err instanceof FFmpegExitError || err instanceof MediaError) throw err;
        // Anything else means the worker itself broke (a crashed thread, out of
        // memory, the watchdog firing). It can't be trusted any more.
        this.discardInstance();
        throw new EngineCrashedError();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private async mount(ffmpeg: FFmpeg, clipId: string) {
    if (this.mounted.has(clipId)) return;
    const file = this.files.get(clipId);
    if (!file) throw new Error("Clip was removed.");
    const { FFFSType } = await import("@ffmpeg/ffmpeg");
    await ffmpeg.createDir(clipDir(clipId));
    await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: "source", data: file }] }, clipDir(clipId));
    this.mounted.add(clipId);
  }
}
