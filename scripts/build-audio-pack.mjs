import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateAuraCutStinger,
  generateSubBoom,
  generateWhoosh,
  generateRiser,
  generateVinylScratch,
} from "./sfx-generator.mjs";

import {
  generatePhonkTrack,
  generateTrapTrack,
  generateAfroTrack,
  generateCinematicTrack,
  generateLoFiTrack,
} from "./music-generator.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sfxDir = join(root, "public", "audio", "sfx");
const musicDir = join(root, "public", "audio", "music");

mkdirSync(sfxDir, { recursive: true });
mkdirSync(musicDir, { recursive: true });

console.log("[build-audio-pack] Generating AuraCut SFX library...");

const sfxList = [
  { file: "auracut_stinger.wav", fn: generateAuraCutStinger },
  { file: "sub_boom.wav", fn: generateSubBoom },
  { file: "whoosh.wav", fn: generateWhoosh },
  { file: "riser.wav", fn: generateRiser },
  { file: "vinyl_scratch.wav", fn: generateVinylScratch },
];

for (const { file, fn } of sfxList) {
  const bytes = fn();
  const path = join(sfxDir, file);
  writeFileSync(path, bytes);
  console.log(`✓ Generated SFX: public/audio/sfx/${file} (${(bytes.length / 1024).toFixed(1)} KB)`);
}

console.log("\n[build-audio-pack] Generating AuraCut Studio Music Beats...");

const musicList = [
  { file: "phonk.wav", fn: generatePhonkTrack },
  { file: "trap.wav", fn: generateTrapTrack },
  { file: "afro.wav", fn: generateAfroTrack },
  { file: "cinematic.wav", fn: generateCinematicTrack },
  { file: "lofi.wav", fn: generateLoFiTrack },
];

for (const { file, fn } of musicList) {
  const bytes = fn();
  const path = join(musicDir, file);
  writeFileSync(path, bytes);
  console.log(`✓ Generated Music: public/audio/music/${file} (${(bytes.length / 1024).toFixed(1)} KB)`);
}

console.log("\n[build-audio-pack] All audio assets generated successfully!");
