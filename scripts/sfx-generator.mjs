import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SAMPLE_RATE = 48000;

function createBuffer(durationSeconds) {
  const numFrames = Math.floor(durationSeconds * SAMPLE_RATE);
  return {
    left: new Float32Array(numFrames),
    right: new Float32Array(numFrames),
    sampleRate: SAMPLE_RATE,
    duration: durationSeconds,
    length: numFrames,
  };
}

function encodeWav(left, right, sampleRate = SAMPLE_RATE) {
  const frames = left.length;
  const count = 2; // stereo
  const bytes = new Uint8Array(44 + frames * count * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * count * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * count * 2, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(o + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    o += 4;
  }
  return bytes;
}

// Tube / Soft-clipping saturation
function saturate(x, drive = 1.5) {
  return Math.tanh(x * drive);
}

// Exponential decay envelope
function envExp(t, startT, decayRate) {
  if (t < startT) return 0;
  return Math.exp(-(t - startT) * decayRate);
}

// Linear envelope with attack and release
function envAD(t, startT, attack, decay) {
  if (t < startT) return 0;
  const elapsed = t - startT;
  if (elapsed < attack) return elapsed / attack;
  return Math.exp(-(elapsed - attack) * decay);
}

// 1. AuraCut Stinger Outro Sound:
// Electric tension riser -> metallic scissor slash -> 808 sub explosion -> neon aura chime shimmer
export function generateAuraCutStinger() {
  const buf = createBuffer(1.6);
  const { left, right, length, sampleRate } = buf;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;

    // A. 0.0s - 0.22s: Electric pitch riser swoosh
    let riser = 0;
    if (t < 0.22) {
      const riserFreq = 120 + Math.pow(t / 0.22, 2.5) * 800;
      const phase = 2 * Math.PI * riserFreq * t;
      const pan = (t / 0.22) * 0.4 - 0.2; // pan left to right
      const riserEnv = Math.pow(t / 0.22, 2) * 0.45;
      riser = (Math.sin(phase) + 0.3 * Math.sin(phase * 2)) * riserEnv;
      left[i] += riser * (0.5 - pan);
      right[i] += riser * (0.5 + pan);
    }

    // B. 0.20s - 0.32s: Metallic razor scissor slash transient
    if (t >= 0.20 && t < 0.35) {
      const slashT = t - 0.20;
      const slashEnv = envExp(t, 0.20, 32);
      const noise = (Math.random() * 2 - 1) * slashEnv;
      const metallic = Math.sin(2 * Math.PI * 3400 * slashT) * Math.sin(2 * Math.PI * 1800 * slashT) * slashEnv;
      const slash = (noise * 0.6 + metallic * 0.4) * 0.65;
      left[i] += slash * 0.9;
      right[i] += slash * 1.1;
    }

    // C. 0.22s - 1.6s: Massive 808 Sub-Bass Explosion
    if (t >= 0.22) {
      const boomT = t - 0.22;
      const boomPitch = Math.max(34, 110 * Math.exp(-boomT * 12));
      const boomPhase = 2 * Math.PI * boomPitch * boomT;
      const boomEnv = Math.exp(-boomT * 2.8);
      // Saturated sub bass with harmonic warmth
      const fundamental = Math.sin(boomPhase);
      const subHarmonic = Math.sin(boomPhase * 0.5) * 0.4;
      const secondHarmonic = Math.sin(boomPhase * 2) * 0.25;
      const boomRaw = (fundamental + subHarmonic + secondHarmonic) * boomEnv * 1.35;
      const boom = saturate(boomRaw, 1.8) * 0.85;

      // Stereo sub rumble
      const stereoDetune = Math.sin(boomPhase * 1.004) * boomEnv * 0.15;
      left[i] += boom - stereoDetune;
      right[i] += boom + stereoDetune;
    }

    // D. 0.25s - 1.6s: Glowing Aura Chime / Shimmer tail (E major chord: E5, G#5, B5, E6)
    if (t >= 0.24) {
      const chimeT = t - 0.24;
      const chimeEnv = Math.exp(-chimeT * 2.2) * (1 - Math.exp(-chimeT * 30));
      const freqs = [659.25, 830.61, 987.77, 1318.51, 1975.53]; // E5, G#5, B5, E6, B6
      let chimeLeft = 0;
      let chimeRight = 0;
      freqs.forEach((f, idx) => {
        const ph = 2 * Math.PI * f * chimeT;
        const wave = Math.sin(ph) + 0.2 * Math.sin(ph * 2);
        const pan = (idx % 2 === 0 ? 0.35 : -0.35);
        chimeLeft += wave * (0.5 - pan);
        chimeRight += wave * (0.5 + pan);
      });
      const shimmer = (chimeLeft + chimeRight) * chimeEnv * 0.18;
      left[i] += chimeLeft * chimeEnv * 0.14;
      right[i] += chimeRight * chimeEnv * 0.14;
    }

    // Master fade out in last 0.15s to guarantee 0 clicks
    if (t > 1.45) {
      const fadeOut = Math.max(0, (1.6 - t) / 0.15);
      left[i] *= fadeOut;
      right[i] *= fadeOut;
    }
  }

  // Normalize / Soft limit to -0.3 dB
  let peak = 0;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0) {
    const scale = 0.95 / peak;
    for (let i = 0; i < length; i++) {
      left[i] = saturate(left[i] * scale, 1.1);
      right[i] = saturate(right[i] * scale, 1.1);
    }
  }

  return encodeWav(left, right, sampleRate);
}

// 2. Sub-Boom SFX (Earth-shaking 808 drop)
export function generateSubBoom() {
  const buf = createBuffer(1.8);
  const { left, right, length, sampleRate } = buf;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const pitch = Math.max(32, 130 * Math.exp(-t * 9));
    const phase = 2 * Math.PI * pitch * t;
    const env = Math.exp(-t * 2.2);
    const sub = saturate((Math.sin(phase) + 0.35 * Math.sin(phase * 2)) * env * 1.5, 1.6) * 0.88;
    const rumble = Math.sin(phase * 1.008) * env * 0.12;
    left[i] = sub - rumble;
    right[i] = sub + rumble;
    if (t > 1.6) {
      const f = (1.8 - t) / 0.2;
      left[i] *= f;
      right[i] *= f;
    }
  }
  return encodeWav(left, right, sampleRate);
}

// 3. Whoosh SFX (Fast transition swoosh)
export function generateWhoosh() {
  const buf = createBuffer(0.65);
  const { left, right, length, sampleRate } = buf;
  let filterStateL = 0;
  let filterStateR = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / 0.65;
    const centerFreq = 300 + Math.sin(p * Math.PI) * 2800;
    const pan = (p - 0.5) * 1.4; // left to right sweep
    const env = Math.sin(p * Math.PI);
    const whiteNoise = (Math.random() * 2 - 1);
    const alpha = (2 * Math.PI * centerFreq) / sampleRate;
    filterStateL += alpha * (whiteNoise - filterStateL);
    filterStateR += alpha * (whiteNoise - filterStateR);
    const sample = filterStateL * env * 0.85;
    left[i] = sample * (1 - Math.max(0, pan));
    right[i] = sample * (1 + Math.min(0, pan));
  }
  return encodeWav(left, right, sampleRate);
}

// 4. Tension Riser SFX
export function generateRiser() {
  const buf = createBuffer(2.2);
  const { left, right, length, sampleRate } = buf;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / 2.2;
    const freq = 120 * Math.pow(16, p); // 120 Hz to 1920 Hz
    const phase = 2 * Math.PI * freq * t;
    const env = Math.pow(p, 2.2) * 0.8;
    const pulse = Math.sin(phase) + 0.4 * Math.sin(phase * 2) + 0.2 * Math.sin(phase * 3);
    const flange = Math.sin(2 * Math.PI * 4 * t) * 0.15;
    left[i] = (pulse + flange) * env;
    right[i] = (pulse - flange) * env;
    if (t > 2.05) {
      const f = (2.2 - t) / 0.15;
      left[i] *= f;
      right[i] *= f;
    }
  }
  return encodeWav(left, right, sampleRate);
}

// 5. Vinyl Scratch / Record Stop SFX
export function generateVinylScratch() {
  const buf = createBuffer(0.7);
  const { left, right, length, sampleRate } = buf;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Slowing down tape/record: pitch drops rapidly then chirps
    const speed = Math.max(0.05, 1 - t / 0.55);
    const freq = 800 * speed + Math.sin(t * 70) * 150;
    const phase = 2 * Math.PI * freq * t;
    const crackle = Math.random() < 0.08 ? (Math.random() * 2 - 1) * 0.4 : 0;
    const tone = Math.sin(phase) * (Math.random() * 0.2 + 0.8);
    const env = Math.exp(-t * 5.5);
    const sig = (tone * 0.65 + crackle) * env;
    left[i] = sig;
    right[i] = sig * 0.95;
  }
  return encodeWav(left, right, sampleRate);
}
