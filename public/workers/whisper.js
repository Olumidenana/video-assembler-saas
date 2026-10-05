// Speech recognition (Whisper) for auto-captions, in a Web Worker so the
// editor stays responsive. Runs entirely on the user's device; only the model
// weights are downloaded (from Hugging Face, then cached by the browser).
import { env, pipeline } from "/vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
// Self-hosted ONNX Runtime (see scripts/copy-ffmpeg-core.mjs).
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/vendor/ort/ort-wasm-simd-threaded.mjs",
  wasm: "/vendor/ort/ort-wasm-simd-threaded.wasm",
};

let current = { model: null, transcriber: null };

async function load(model) {
  if (current.model === model && current.transcriber) return current.transcriber;
  const transcriber = await pipeline("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        self.postMessage({ type: "download", file: p.file, loaded: p.loaded, total: p.total });
      }
    },
  });
  current = { model, transcriber };
  return transcriber;
}

self.onmessage = async ({ data }) => {
  const { id, model, audio, offset, multilingual, language, task } = data;
  try {
    const transcriber = await load(model);
    self.postMessage({ type: "ready", id });
    const output = await transcriber(audio, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      // English-only models must not be given a language or task. Without a
      // language, multilingual models detect it; "translate" writes English.
      ...(multilingual ? { task: task ?? "transcribe", ...(language ? { language } : {}) } : {}),
    });
    const words = (output.chunks ?? [])
      .map((c) => {
        const [start, end] = c.timestamp ?? [];
        return { text: String(c.text ?? "").trim(), start: offset + (start ?? 0), end: offset + (end ?? (start ?? 0) + 0.3) };
      })
      .filter((w) => w.text);
    self.postMessage({ type: "result", id, words });
  } catch (err) {
    self.postMessage({ type: "error", id, message: String(err?.message ?? err) });
  }
};
