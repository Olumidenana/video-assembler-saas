// Downloads transformers.js (in-browser Whisper for captions) from the npm
// registry into public/vendor/transformers, verified against the registry's
// integrity hash. It isn't an npm dependency because its onnxruntime-node
// dependency downloads large native binaries we never use, and it isn't
// committed because its minified source trips GitHub's secret scanner.
// Runs on postinstall, predev and prebuild; skips when already present.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const VERSION = "4.3.0";
const INTEGRITY = "sha512-fL1A/WUZwouPrOlYxU5dzIwD2T5J781JiB2jDR8bFe5DwCj0Gfudq+NEXCMno49kQgajHA7xQkrRLJlqG1veEA==";
const FILES = { "package/dist/transformers.min.js": "transformers.min.js", "package/LICENSE": "LICENSE" };

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor", "transformers");
if (Object.values(FILES).every((f) => existsSync(join(dest, f)))) process.exit(0);

const registry = (process.env.npm_config_registry || "https://registry.npmjs.org/").replace(/\/?$/, "/");
const url = `${registry}@huggingface/transformers/-/transformers-${VERSION}.tgz`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`[fetch-transformers] ${url} returned ${res.status}`);
  process.exit(1);
}
const tgz = Buffer.from(await res.arrayBuffer());
if (`sha512-${createHash("sha512").update(tgz).digest("base64")}` !== INTEGRITY) {
  console.error("[fetch-transformers] integrity check failed");
  process.exit(1);
}

// Minimal tar reader: 512-byte header (name at 0, octal size at 124), then the data padded to 512.
const tar = gunzipSync(tgz);
mkdirSync(dest, { recursive: true });
let found = 0;
for (let offset = 0; offset + 512 <= tar.length; ) {
  const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/s, "");
  if (!name) break;
  const size = parseInt(tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/s, "").trim() || "0", 8);
  if (FILES[name]) {
    writeFileSync(join(dest, FILES[name]), tar.subarray(offset + 512, offset + 512 + size));
    found++;
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
if (found !== Object.keys(FILES).length) {
  console.error("[fetch-transformers] files missing from the package");
  process.exit(1);
}
console.log(`[fetch-transformers] @huggingface/transformers@${VERSION} -> public/vendor/transformers`);
