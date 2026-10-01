// Copies the FFmpeg.wasm cores and the @ffmpeg/ffmpeg worker from node_modules into public/ffmpeg so they are
// served from our own origin. Under COEP: require-corp a CDN copy would be
// blocked unless the CDN sends CORP/CORS headers, and self-hosting also avoids
// a runtime dependency on a third party. Runs on postinstall, predev and prebuild.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  // Multi-threaded core: used when the page is crossOriginIsolated.
  { pkg: "@ffmpeg/core-mt", out: "mt", files: ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"] },
  // Single-threaded fallback: used when SharedArrayBuffer is unavailable.
  { pkg: "@ffmpeg/core", out: "st", files: ["ffmpeg-core.js", "ffmpeg-core.wasm"] },
  // @ffmpeg/ffmpeg's own worker, loaded via `classWorkerURL` so the bundler never
  // has to understand its `new Worker(new URL(...))` pattern.
  { pkg: "@ffmpeg/ffmpeg", out: "class", files: ["worker.js", "const.js", "errors.js"] },
  // ONNX Runtime for in-browser speech recognition (captions). The version is
  // pinned in package.json to the one public/vendor/transformers expects.
  // asyncify = WebGPU-capable build; plain = CPU (WebAssembly) build.
  {
    pkg: "onnxruntime-web",
    dist: "dist",
    dest: "public/vendor/ort",
    files: [
      "ort-wasm-simd-threaded.asyncify.mjs",
      "ort-wasm-simd-threaded.asyncify.wasm",
      "ort-wasm-simd-threaded.mjs",
      "ort-wasm-simd-threaded.wasm",
    ],
  },
];

for (const { pkg, out, files, dist = "dist/esm", dest: destDir } of targets) {
  const src = join(root, "node_modules", pkg, dist);
  const dest = destDir ? join(root, destDir) : join(root, "public", "ffmpeg", out);
  mkdirSync(dest, { recursive: true });
  for (const file of files) {
    const from = join(src, file);
    if (!existsSync(from)) {
      console.error(`[copy-ffmpeg-core] missing ${from}. Did npm install finish?`);
      process.exit(1);
    }
    cpSync(from, join(dest, file));
  }
  console.log(`[copy-ffmpeg-core] ${pkg} -> ${destDir ?? `public/ffmpeg/${out}`}`);
}
