/**
 * Auto-captions: extracts a clip's audio with FFmpeg (16 kHz mono) and runs
 * Whisper in a Web Worker (public/workers/whisper.js), in windows of a few
 * minutes so long videos don't exhaust memory on phones.
 */
import type { Word } from "./captions";
import { CancelledError, type VideoEngine } from "./engine";
import type { MediaInfo } from "./types";

export type CaptionLanguage = "english" | "other";

/** Long videos are transcribed in windows of this many seconds. */
const WINDOW_SECONDS = 300;

/** Smaller, faster model on low-powered devices; better accuracy elsewhere. */
export function pickModel(language: CaptionLanguage): string {
  const weak = typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4;
  const size = weak ? "tiny" : "base";
  return language === "english" ? `Xenova/whisper-${size}.en` : `Xenova/whisper-${size}`;
}

export interface TranscribeProgress {
  stage: "download" | "listening";
  /** 0..1 */
  progress: number;
}

type WorkerMessage =
  | { type: "download"; loaded: number; total: number; file: string }
  | { type: "ready"; id: number }
  | { type: "result"; id: number; words: Word[] }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let nextId = 1;
/** Rejects the windows in flight; terminating a worker doesn't settle them. */
const pending = new Set<(err: Error) => void>();

function getWorker(): Worker {
  worker ??= new Worker("/workers/whisper.js", { type: "module" });
  return worker;
}

/** Stops any transcription in progress (the next call starts a fresh worker). */
export function cancelTranscription() {
  worker?.terminate();
  worker = null;
  for (const reject of pending) reject(new CancelledError());
  pending.clear();
}

function transcribeWindow(
  audio: Float32Array,
  offset: number,
  language: CaptionLanguage,
  onDownload: (ratio: number) => void,
): Promise<Word[]> {
  const w = getWorker();
  const id = nextId++;
  const downloads = new Map<string, { loaded: number; total: number }>();
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === "download") {
        downloads.set(data.file, data);
        const all = [...downloads.values()];
        onDownload(all.reduce((s, d) => s + d.loaded, 0) / all.reduce((s, d) => s + d.total, 0));
        return;
      }
      if (data.id !== id) return;
      if (data.type === "result") {
        cleanup();
        resolve(data.words);
      } else if (data.type === "error") {
        cleanup();
        reject(new Error(data.message));
      }
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || "Speech recognition failed to start"));
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      pending.delete(reject);
    };
    pending.add(reject);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage(
      { id, model: pickModel(language), audio, offset, multilingual: language !== "english" },
      [audio.buffer],
    );
  });
}

/** Transcribes a whole clip into word timings (seconds in the clip). */
export async function transcribeClip(
  engine: VideoEngine,
  clipId: string,
  info: MediaInfo,
  language: CaptionLanguage,
  onProgress: (p: TranscribeProgress) => void,
): Promise<Word[]> {
  if (!info.audioCodec) return [];
  const words: Word[] = [];
  for (let start = 0; start < info.duration; start += WINDOW_SECONDS) {
    const duration = Math.min(WINDOW_SECONDS, info.duration - start);
    const audio = await engine.extractAudio(clipId, start, duration);
    onProgress({ stage: "listening", progress: start / info.duration });
    words.push(
      ...(await transcribeWindow(audio, start, language, (ratio) => onProgress({ stage: "download", progress: ratio }))),
    );
  }
  onProgress({ stage: "listening", progress: 1 });
  return words;
}
