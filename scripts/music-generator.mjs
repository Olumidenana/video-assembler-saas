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
  view.setUint16(20, 1, true);
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

function saturate(x, drive = 1.4) {
  return Math.tanh(x * drive);
}

// Synthesis helpers for authentic instruments
function addKick(buf, startT, pitch = 120, decay = 8, volume = 0.85) {
  const start = Math.floor(startT * buf.sampleRate);
  const len = Math.floor(0.45 * buf.sampleRate);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / buf.sampleRate;
    const f = Math.max(38, pitch * Math.exp(-t * 22));
    const phase = 2 * Math.PI * f * t;
    const env = Math.exp(-t * decay);
    const click = Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 90) * 0.25;
    const sample = (Math.sin(phase) + click) * env * volume;
    buf.left[idx] += sample;
    buf.right[idx] += sample;
  }
}

function addSnare(buf, startT, volume = 0.65, snappy = 0.5) {
  const start = Math.floor(startT * buf.sampleRate);
  const len = Math.floor(0.35 * buf.sampleRate);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / buf.sampleRate;
    const tone = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 18) * 0.5;
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * (14 + snappy * 16)) * 0.7;
    const sample = (tone + noise) * volume;
    buf.left[idx] += sample * 0.95;
    buf.right[idx] += sample * 1.05;
  }
}

function addClap(buf, startT, volume = 0.7) {
  const offsets = [0, 0.012, 0.024];
  offsets.forEach((dt, j) => {
    const isLast = j === offsets.length - 1;
    const decay = isLast ? 18 : 65;
    const vol = (isLast ? 0.75 : 0.4) * volume;
    const start = Math.floor((startT + dt) * buf.sampleRate);
    const len = Math.floor(0.3 * buf.sampleRate);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= buf.length) break;
      const t = i / buf.sampleRate;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * decay) * vol;
      buf.left[idx] += noise * 0.9;
      buf.right[idx] += noise * 1.1;
    }
  });
}

function addHiHat(buf, startT, open = false, volume = 0.35, pan = 0) {
  const start = Math.floor(startT * buf.sampleRate);
  const dur = open ? 0.35 : 0.07;
  const decay = open ? 9 : 55;
  const len = Math.floor(dur * buf.sampleRate);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / buf.sampleRate;
    // Metallic metallic square cluster
    const m = Math.sin(2 * Math.PI * 8200 * t) * Math.sin(2 * Math.PI * 5400 * t);
    const n = (Math.random() * 2 - 1) * 0.6;
    const sample = (m * 0.4 + n) * Math.exp(-t * decay) * volume;
    buf.left[idx] += sample * (1 - pan);
    buf.right[idx] += sample * (1 + pan);
  }
}

function add808Bass(buf, startT, dur, freq, volume = 0.8, slideTo = null) {
  const start = Math.floor(startT * buf.sampleRate);
  const len = Math.floor(dur * buf.sampleRate);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / buf.sampleRate;
    let currentFreq = freq;
    if (slideTo) {
      const p = Math.min(1, t / (dur * 0.6));
      currentFreq = freq + (slideTo - freq) * p;
    }
    const phase = 2 * Math.PI * currentFreq * t;
    const env = t < 0.015 ? t / 0.015 : Math.exp(-(t - 0.015) * (2.8 / dur));
    // Saturated 808 with 2nd and 3rd harmonics
    const raw = (Math.sin(phase) + 0.38 * Math.sin(phase * 2) + 0.15 * Math.sin(phase * 3)) * env * volume;
    const sample = saturate(raw, 2.0);
    buf.left[idx] += sample;
    buf.right[idx] += sample;
  }
}

// 1. Phonk Drift (130 BPM, 8 bars = 14.77s)
export function generatePhonkTrack() {
  const bpm = 130;
  const beat = 60 / bpm; // ~0.4615s
  const duration = beat * 32; // 8 bars ~14.77s
  const buf = createBuffer(duration);

  // Drums pattern:
  // Kicks on beat 0, 1.5, 2.5 of each bar
  // Claps on beat 2 of each bar
  // Hats every 1/2 beat with triplet roll every 4th bar
  for (let bar = 0; bar < 8; bar++) {
    const barT = bar * 4 * beat;
    addKick(buf, barT + 0 * beat, 140, 7, 0.9);
    addKick(buf, barT + 1.5 * beat, 130, 7, 0.85);
    addKick(buf, barT + 2.5 * beat, 130, 7, 0.85);

    addClap(buf, barT + 2 * beat, 0.75);

    for (let h = 0; h < 8; h++) {
      addHiHat(buf, barT + h * 0.5 * beat, false, 0.3, (h % 2 === 0 ? 0.2 : -0.2));
    }
  }

  // 808 Bass Line (A1, C2, D2, F2)
  const bassNotes = [55, 55, 65.4, 73.4, 55, 55, 87.3, 73.4];
  bassNotes.forEach((f, bar) => {
    const barT = bar * 4 * beat;
    add808Bass(buf, barT, beat * 3.5, f, 0.85);
  });

  // Memphis Cowbell Melody (The iconic Drift Phonk lead)
  // Pitches: A4 (440), C5 (523), E5 (659), D5 (587), A5 (880), G5 (784)
  const melody = [
    { t: 0, f: 880 }, { t: 0.5, f: 880 }, { t: 1, f: 659 }, { t: 1.5, f: 784 },
    { t: 2, f: 880 }, { t: 2.75, f: 1046 }, { t: 3.25, f: 987 }, { t: 3.75, f: 880 }
  ];
  for (let bar = 0; bar < 8; bar++) {
    const barT = bar * 4 * beat;
    melody.forEach((m) => {
      const noteT = barT + m.t * beat;
      const start = Math.floor(noteT * buf.sampleRate);
      const len = Math.floor(0.28 * buf.sampleRate);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= buf.length) break;
        const t = i / buf.sampleRate;
        const sq1 = Math.sign(Math.sin(2 * Math.PI * m.f * t));
        const sq2 = Math.sign(Math.sin(2 * Math.PI * (m.f * 1.505) * t));
        const env = Math.exp(-t * 16);
        const sample = (sq1 * 0.6 + sq2 * 0.4) * env * 0.42;
        buf.left[idx] += sample * 0.9;
        buf.right[idx] += sample * 1.1;
      }
    });
  }

  // Master limiting
  normalizeBuffer(buf);
  return encodeWav(buf.left, buf.right, buf.sampleRate);
}

// 2. Hype Trap (140 BPM, 8 bars = 13.71s)
export function generateTrapTrack() {
  const bpm = 140;
  const beat = 60 / bpm;
  const duration = beat * 32;
  const buf = createBuffer(duration);

  for (let bar = 0; bar < 8; bar++) {
    const barT = bar * 4 * beat;
    addKick(buf, barT, 150, 6, 0.95);
    addKick(buf, barT + 1.75 * beat, 140, 6, 0.85);
    addKick(buf, barT + 3.0 * beat, 140, 6, 0.85);

    addClap(buf, barT + 2 * beat, 0.8);

    // Fast 16th hats with 32nd roll in bar 4 & 8
    const roll = bar === 3 || bar === 7;
    for (let h = 0; h < 16; h++) {
      const subT = barT + h * 0.25 * beat;
      addHiHat(buf, subT, false, roll && h >= 12 ? 0.45 : 0.28, Math.sin(h) * 0.3);
    }
  }

  // 808 Slides (C1: 32.7Hz, Eb1: 38.9Hz, G1: 49.0Hz, F1: 43.6Hz)
  const trap808 = [
    { bar: 0, f: 32.7, slide: null },
    { bar: 1, f: 38.9, slide: 49.0 },
    { bar: 2, f: 32.7, slide: null },
    { bar: 3, f: 43.6, slide: 32.7 },
    { bar: 4, f: 32.7, slide: null },
    { bar: 5, f: 38.9, slide: 49.0 },
    { bar: 6, f: 32.7, slide: null },
    { bar: 7, f: 43.6, slide: 32.7 },
  ];
  trap808.forEach((n) => {
    const barT = n.bar * 4 * beat;
    add808Bass(buf, barT, beat * 3.8, n.f, 0.9, n.slide);
  });

  // Dramatic Brass Horn Stabs
  const brassNotes = [130.8, 155.6, 196.0]; // C3, Eb3, G3
  for (let bar = 0; bar < 8; bar++) {
    const barT = bar * 4 * beat;
    const hitTimes = [0, 2.5];
    hitTimes.forEach((ht) => {
      const noteT = barT + ht * beat;
      const start = Math.floor(noteT * buf.sampleRate);
      const len = Math.floor(0.7 * buf.sampleRate);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= buf.length) break;
        const t = i / buf.sampleRate;
        let chord = 0;
        brassNotes.forEach((f) => {
          chord += (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2 * t) + 0.2 * Math.sin(2 * Math.PI * f * 3 * t));
        });
        const env = Math.exp(-t * 4.5);
        const sample = saturate(chord * env * 0.28, 1.3);
        buf.left[idx] += sample * 0.95;
        buf.right[idx] += sample * 1.05;
      }
    });
  }

  normalizeBuffer(buf);
  return encodeWav(buf.left, buf.right, buf.sampleRate);
}

// 3. Afrobeats & Amapiano (113 BPM, 8 bars = 16.99s)
export function generateAfroTrack() {
  const bpm = 113;
  const beat = 60 / bpm;
  const duration = beat * 32;
  const buf = createBuffer(duration);

  for (let bar = 0; bar < 8; bar++) {
    const barT = bar * 4 * beat;
    addKick(buf, barT + 0 * beat, 110, 9, 0.85);
    addKick(buf, barT + 1.5 * beat, 110, 9, 0.75);
    addKick(buf, barT + 3.0 * beat, 110, 9, 0.8);

    // Afro shaker syncopation (16th notes with accent on 3, 7, 11, 15)
    for (let s = 0; s < 16; s++) {
      const isAccent = (s % 4 === 2);
      const sT = barT + s * 0.25 * beat;
      const start = Math.floor(sT * buf.sampleRate);
      const len = Math.floor(0.12 * buf.sampleRate);
      const vol = isAccent ? 0.38 : 0.18;
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= buf.length) break;
        const t = i / buf.sampleRate;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 38) * vol;
        buf.left[idx] += noise * (isAccent ? 1.1 : 0.85);
        buf.right[idx] += noise * (isAccent ? 0.85 : 1.1);
      }
    }

    // Amapiano Log Drum Rolls (The signature wooden pitch-dive bass)
    const logHits = [
      { t: 0.75, f: 90 }, { t: 2.25, f: 85 }, { t: 2.75, f: 100 }, { t: 3.5, f: 75 }
    ];
    logHits.forEach((lh) => {
      const logT = barT + lh.t * beat;
      const start = Math.floor(logT * buf.sampleRate);
      const len = Math.floor(0.4 * buf.sampleRate);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= buf.length) break;
        const t = i / buf.sampleRate;
        const f = Math.max(38, lh.f * Math.exp(-t * 18));
        // FM Synthesis for authentic hollow wood texture
        const mod = Math.sin(2 * Math.PI * 180 * t) * 45;
        const carrier = Math.sin(2 * Math.PI * (f + mod) * t);
        const env = Math.exp(-t * 6.5);
        const sample = saturate(carrier * env * 1.25, 1.4) * 0.88;
        buf.left[idx] += sample;
        buf.right[idx] += sample;
      }
    });

    // Warm Rhodes Piano Chords (F Major: F3, A3, C4, E4)
    const chordT = barT + 0.25 * beat;
    const start = Math.floor(chordT * buf.sampleRate);
    const len = Math.floor(1.6 * buf.sampleRate);
    const rhodesNotes = [174.6, 220.0, 261.6, 329.6];
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= buf.length) break;
      const t = i / buf.sampleRate;
      let chord = 0;
      rhodesNotes.forEach((rf) => {
        chord += (Math.sin(2 * Math.PI * rf * t) + 0.25 * Math.sin(2 * Math.PI * rf * 2 * t));
      });
      const env = Math.exp(-t * 1.8);
      const tremolo = 1 + 0.15 * Math.sin(2 * Math.PI * 4 * t);
      const sample = chord * env * tremolo * 0.14;
      buf.left[idx] += sample * 0.9;
      buf.right[idx] += sample * 1.1;
    }
  }

  normalizeBuffer(buf);
  return encodeWav(buf.left, buf.right, buf.sampleRate);
}

// 4. Epic Cinematic Trailer (90 BPM, 6 bars = 16.0s)
export function generateCinematicTrack() {
  const bpm = 90;
  const beat = 60 / bpm;
  const duration = beat * 24; // 16.0s
  const buf = createBuffer(duration);

  for (let bar = 0; bar < 6; bar++) {
    const barT = bar * 4 * beat;

    // Thunderous Taiko Drum Impact on downbeat
    const start = Math.floor(barT * buf.sampleRate);
    const len = Math.floor(1.5 * buf.sampleRate);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= buf.length) break;
      const t = i / buf.sampleRate;
      const f = Math.max(35, 110 * Math.exp(-t * 12));
      const sub = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.5);
      const crack = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.4;
      const sample = (sub + crack) * 0.95;
      buf.left[idx] += sample;
      buf.right[idx] += sample;
    }

    // Heavy Trailer Braam (D2: 73.4Hz + F2: 87.3Hz + A2: 110Hz with rich brass overtones)
    const braamLen = Math.floor(2.2 * buf.sampleRate);
    for (let i = 0; i < braamLen; i++) {
      const idx = start + i;
      if (idx >= buf.length) break;
      const t = i / buf.sampleRate;
      let braam = 0;
      [73.4, 87.3, 110.0].forEach((bf) => {
        braam += Math.sin(2 * Math.PI * bf * t) + 0.5 * Math.sin(2 * Math.PI * bf * 2 * t) + 0.3 * Math.sin(2 * Math.PI * bf * 3 * t);
      });
      const env = (t < 0.1 ? t / 0.1 : Math.exp(-(t - 0.1) * 1.5));
      const sample = saturate(braam * env * 0.45, 1.8);
      buf.left[idx] += sample * 0.95;
      buf.right[idx] += sample * 1.05;
    }

    // Soaring Legato Strings in background
    const stringLen = Math.floor(4 * beat * buf.sampleRate);
    for (let i = 0; i < stringLen; i++) {
      const idx = start + i;
      if (idx >= buf.length) break;
      const t = i / buf.sampleRate;
      const s1 = Math.sin(2 * Math.PI * 293.66 * t); // D4
      const s2 = Math.sin(2 * Math.PI * 349.23 * t); // F4
      const s3 = Math.sin(2 * Math.PI * 440.0 * t); // A4
      const env = Math.sin((t / (4 * beat)) * Math.PI);
      const sample = (s1 + s2 + s3) * env * 0.09;
      buf.left[idx] += sample;
      buf.right[idx] += sample;
    }
  }

  normalizeBuffer(buf);
  return encodeWav(buf.left, buf.right, buf.sampleRate);
}

// 5. Chill Lo-Fi (80 BPM, 6 bars = 18.0s)
export function generateLoFiTrack() {
  const bpm = 80;
  const beat = 60 / bpm;
  const duration = beat * 24; // 18.0s
  const buf = createBuffer(duration);

  // Subtle Vinyl Crackle & Dust bed
  for (let i = 0; i < buf.length; i++) {
    if (Math.random() < 0.008) {
      const pop = (Math.random() * 2 - 1) * 0.08;
      buf.left[i] += pop;
      buf.right[i] += pop * 0.9;
    }
  }

  for (let bar = 0; bar < 6; bar++) {
    const barT = bar * 4 * beat;

    // Mellow Boom-Bap Drums
    addKick(buf, barT + 0 * beat, 95, 9, 0.7);
    addKick(buf, barT + 2.5 * beat, 90, 9, 0.6);
    addSnare(buf, barT + 1 * beat, 0.45, 0.2);
    addSnare(buf, barT + 3 * beat, 0.45, 0.2);

    for (let h = 0; h < 8; h++) {
      // Swung 8th notes
      const swing = (h % 2 === 1 ? 0.03 : 0);
      addHiHat(buf, barT + (h * 0.5 + swing) * beat, false, 0.2, (h % 2 === 0 ? 0.15 : -0.15));
    }

    // Warm Vintage Rhodes Chords (Fmaj7 -> Dm7)
    const chordNotes = (bar % 2 === 0)
      ? [174.6, 220.0, 261.6, 329.6] // F3, A3, C4, E4
      : [146.8, 174.6, 220.0, 261.6]; // D3, F3, A3, C4
    const start = Math.floor(barT * buf.sampleRate);
    const len = Math.floor(3.8 * beat * buf.sampleRate);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= buf.length) break;
      const t = i / buf.sampleRate;
      let rhodes = 0;
      chordNotes.forEach((rf) => {
        rhodes += Math.sin(2 * Math.PI * rf * t) + 0.3 * Math.sin(2 * Math.PI * rf * 2 * t);
      });
      const env = Math.exp(-t * 0.95);
      const trem = 1 + 0.18 * Math.sin(2 * Math.PI * 3.5 * t);
      const sample = rhodes * env * trem * 0.13;
      buf.left[idx] += sample * 0.95;
      buf.right[idx] += sample * 1.05;
    }
  }

  normalizeBuffer(buf);
  return encodeWav(buf.left, buf.right, buf.sampleRate);
}

function normalizeBuffer(buf, targetDb = -0.5) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    peak = Math.max(peak, Math.abs(buf.left[i]), Math.abs(buf.right[i]));
  }
  if (peak > 0) {
    const targetAmp = Math.pow(10, targetDb / 20);
    const scale = targetAmp / peak;
    for (let i = 0; i < buf.length; i++) {
      buf.left[i] = saturate(buf.left[i] * scale, 1.05);
      buf.right[i] = saturate(buf.right[i] * scale, 1.05);
    }
  }
}
