import type { FFmpeg } from "@ffmpeg/ffmpeg";
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
    { totalDuration, onProgress }: RunOptions,
    files: Record<string, string> = {},
  ): Promise<Uint8Array> {
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
      const off = () => {
        offLog();
        this.timeListeners.delete(report);
      };
      try {
        for (const [path, text] of Object.entries(files)) await ffmpeg.writeFile(path, text);
        const code = await ffmpeg.exec(args);
        if (code !== 0) {
          throw new FFmpegExitError(`FFmpeg failed (exit ${code}).\n${tail.join("\n")}`);
        }
        onProgress?.(1);
        const data = await ffmpeg.readFile(output);
        return data as Uint8Array;
      } finally {
        clearInterval(watchdog);
        off();
        for (const path of [output, ...Object.keys(files)]) {
          await ffmpeg.deleteFile(path).catch(() => {});
        }
      }
    }, clipIds);
  }

  /** Stops whatever is running. Queued operations fail with CancelledError. */
  cancel(): void {
    this.generation++;
    this.queue = Promise.resolve();
    this.discardInstance();
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
