/**
 * Auto-captions: extracts a clip's audio with FFmpeg (16 kHz mono) and runs
 * Whisper in a Web Worker (public/workers/whisper.js), in windows of a few
 * minutes so long videos don't exhaust memory on phones.
 */
import type { Word } from "./captions";
import { CancelledError, type VideoEngine } from "./engine";
import type { MediaInfo } from "./types";

/** What to listen for and how to caption it. */
export interface SpeechOptions {
  /** "auto" to detect, or a Whisper language code ("en", "ja", "yo", …). */
  language: string;
  /** Write the captions in English whatever language is spoken. */
  translate: boolean;
  /** "high" uses a bigger model: better for accents and non-English, larger first download. */
  quality: "standard" | "high";
}

export const DEFAULT_SPEECH: SpeechOptions = { language: "auto", translate: false, quality: "standard" };

/** Languages offered in the picker; Whisper understands ~99 (auto-detect covers the rest). */
export const SPEECH_LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Detect automatically" },
  { code: "en", label: "English (incl. Pidgin)" },
  { code: "yo", label: "Yoruba" },
  { code: "ha", label: "Hausa" },
  { code: "sw", label: "Swahili" },
  { code: "am", label: "Amharic" },
  { code: "fr", label: "French" },
  { code: "ar", label: "Arabic" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "id", label: "Indonesian" },
  { code: "tl", label: "Filipino" },
  { code: "ja", label: "Japanese (anime)" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
];

/** Settings saved before languages were selectable. */
export function migrateSpeech(saved: unknown): SpeechOptions {
  if (saved === "english") return { ...DEFAULT_SPEECH, language: "en" };
  if (saved === "other") return DEFAULT_SPEECH;
  const o = (saved ?? {}) as Partial<SpeechOptions>;
  return {
    language: typeof o.language === "string" && SPEECH_LANGUAGES.some((l) => l.code === o.language) ? o.language : "auto",
    translate: o.translate === true,
    quality: o.quality === "high" ? "high" : "standard",
  };
}

/** Transcripts depend on these settings; a change means listening again. */
export const speechKey = (o: SpeechOptions) => `${o.language}|${o.translate ? "en" : "orig"}|${o.quality}`;

/** Long videos are transcribed in windows of this many seconds. */
const WINDOW_SECONDS = 300;

/**
 * Model per setting: English-only models are more accurate for English;
 * every other language (and translation) needs a multilingual one. Low-powered
 * devices get one size smaller so phones don't run out of memory.
 */
export function pickModel(o: SpeechOptions, weak = typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4): string {
  const sizes = o.quality === "high" ? ["base", "small"] : ["tiny", "base"];
  const size = weak ? sizes[0] : sizes[1];
  const englishOnly = o.language === "en" && !o.translate;
  return `Xenova/whisper-${size}${englishOnly ? ".en" : ""}`;
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
  speech: SpeechOptions,
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
      {
        id,
        model: pickModel(speech),
        audio,
        offset,
        multilingual: !pickModel(speech).endsWith(".en"),
        language: speech.language === "auto" ? null : speech.language,
        task: speech.translate ? "translate" : "transcribe",
      },
      [audio.buffer],
    );
  });
}

/** Transcribes a whole clip into word timings (seconds in the clip). */
export async function transcribeClip(
  engine: VideoEngine,
  clipId: string,
  info: MediaInfo,
  speech: SpeechOptions,
  onProgress: (p: TranscribeProgress) => void,
): Promise<Word[]> {
  if (!info.audioCodec) return [];
  const words: Word[] = [];
  for (let start = 0; start < info.duration; start += WINDOW_SECONDS) {
    const duration = Math.min(WINDOW_SECONDS, info.duration - start);
    const audio = await engine.extractAudio(clipId, start, duration);
    onProgress({ stage: "listening", progress: start / info.duration });
    words.push(
      ...(await transcribeWindow(audio, start, speech, (ratio) => onProgress({ stage: "download", progress: ratio }))),
    );
  }
  onProgress({ stage: "listening", progress: 1 });
  return words;
}
