/**
 * Original background music, composed per clip in the browser: no samples,
 * no licences, nothing downloaded. Each track is built so its DROP lands
 * exactly on the clip's biggest moment: a filtered build-up and a riser
 * before it, a beat of silence, then an impact and the full beat.
 *
 * planTrack is pure (testable); renderTrack synthesises the plan with the
 * Web Audio API (OfflineAudioContext) and encodeWav turns it into a file
 * FFmpeg can mix under the video.
 */

export type MusicStyle = "phonk" | "trap" | "afro" | "cinematic" | "lofi";

export const MUSIC_STYLES: { id: MusicStyle; label: string; hint: string; bpm: number }[] = [
  { id: "phonk", label: "Phonk", hint: "Cowbells & distorted 808: anime and car edits", bpm: 130 },
  { id: "trap", label: "Hype trap", hint: "Hard 808s, rolling hats: sports, gaming, motivation", bpm: 140 },
  { id: "afro", label: "Afro / Amapiano", hint: "Log drums & shakers: dance, lifestyle, skits", bpm: 112 },
  { id: "cinematic", label: "Cinematic", hint: "Riser into a huge hit: reveals and epic moments", bpm: 90 },
  { id: "lofi", label: "Lo-fi", hint: "Warm and chill: vlogs, stories, study", bpm: 80 },
];

export type Instrument =
  | "kick"
  | "snare"
  | "clap"
  | "hat"
  | "openhat"
  | "shaker"
  | "rim"
  | "tom"
  | "sub"
  | "cowbell"
  | "logdrum"
  | "pad"
  | "keys"
  | "riser"
  | "impact"
  | "crash"
  | "vinyl";

export interface NoteEvent {
  t: number;
  inst: Instrument;
  /** MIDI note numbers (chords for pad/keys). */
  notes?: number[];
  /** Seconds (sustained instruments, riser). */
  dur?: number;
  /** 0..1 */
  vel: number;
  /** Slide into the note from this MIDI note (808s, log drums). */
  from?: number;
}

export interface TrackPlan {
  style: MusicStyle;
  bpm: number;
  duration: number;
  /** When the beat drops, in seconds. 0 = starts full. */
  dropAt: number;
  events: NoteEvent[];
}

/** Chord roots (MIDI) and qualities per bar, by style. Common progressions, written out here. */
const PROGRESSIONS: Record<MusicStyle, { root: number; minor: boolean; seventh?: boolean }[]> = {
  phonk: [
    { root: 45, minor: true },
    { root: 45, minor: true },
    { root: 41, minor: false },
    { root: 43, minor: false },
  ],
  trap: [
    { root: 40, minor: true },
    { root: 36, minor: false },
    { root: 43, minor: false },
    { root: 38, minor: false },
  ],
  afro: [
    { root: 41, minor: false, seventh: true },
    { root: 43, minor: true, seventh: true },
    { root: 45, minor: true, seventh: true },
    { root: 43, minor: true, seventh: true },
  ],
  cinematic: [
    { root: 38, minor: true },
    { root: 34, minor: false },
    { root: 41, minor: false },
    { root: 36, minor: false },
  ],
  lofi: [
    { root: 41, minor: false, seventh: true },
    { root: 40, minor: true, seventh: true },
    { root: 38, minor: true, seventh: true },
    { root: 43, minor: false, seventh: true },
  ],
};

const chordNotes = (c: { root: number; minor: boolean; seventh?: boolean }, octave = 24) => {
  const third = c.minor ? 3 : 4;
  const seventh = c.minor ? 10 : 11;
  return [0, third, 7, ...(c.seventh ? [seventh] : [])].map((i) => c.root + octave + i);
};

/** Small seeded generator so a preview and its export sound identical. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Phonk cowbell figure: scale steps over the minor pentatonic, -1 = rest. */
const COWBELL = [0, -1, 2, -1, 3, 2, -1, 4, -1, 3, -1, 2, 1, -1, 0, -1];
const PENTA = [0, 3, 5, 7, 10, 12];

/**
 * Lays out every note of a track. The bar grid is aligned so a downbeat falls
 * exactly on `dropAt`; before it the arrangement is sparse and filtered, the
 * last bar builds (snare roll, riser) and a short gap sets up the impact.
 */
export function planTrack(
  style: MusicStyle,
  duration: number,
  dropAt: number,
  seed = 1,
  /** Silence before the drop, in seconds. Trailers hold a full beat of nothing before the hit. */
  pause = 0.12,
): TrackPlan {
  const bpm = MUSIC_STYLES.find((s) => s.id === style)!.bpm;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const rand = seeded(seed);
  // Too early to build up: start with the full beat.
  const drop = dropAt < Math.min(1.5, bar * 0.75) ? 0 : Math.min(dropAt, Math.max(0, duration - 1));
  const origin = drop - Math.ceil(drop / bar) * bar;
  const gap = drop > 0 ? Math.max(0.12, pause) : 0;
  const events: NoteEvent[] = [];
  const add = (e: NoteEvent) => {
    if (e.t < 0 || e.t >= duration) return;
    if (drop > 0 && e.t >= drop - gap && e.t < drop && e.inst !== "riser") return;
    events.push(e);
  };
  const prog = PROGRESSIONS[style];
  const barsPerChord = style === "cinematic" ? 2 : 1;

  if (drop > 0) {
    const riseFrom = Math.max(0, drop - Math.min(4, bar * (style === "lofi" ? 1 : 2)));
    // A long pause cuts the riser off with everything else, so the silence is total.
    const riseTo = gap > 0.2 ? drop - gap : drop;
    events.push({ t: riseFrom, inst: "riser", dur: Math.max(0.1, riseTo - riseFrom), vel: style === "lofi" ? 0.35 : 0.8 });
  }
  if (style !== "lofi") {
    add({ t: drop, inst: "impact", vel: style === "cinematic" ? 1 : 0.8 });
    add({ t: drop, inst: "crash", vel: 0.6 });
  } else {
    add({ t: drop, inst: "crash", vel: 0.25 });
  }
  if (style === "lofi") events.push({ t: 0, inst: "vinyl", dur: duration, vel: 0.5 });

  const totalSteps = Math.ceil((duration - origin) / step);
  for (let i = 0; i < totalSteps; i++) {
    const t = origin + i * step;
    const s = i % 16;
    const barIndex = Math.floor(i / 16);
    const chord = prog[Math.floor(barIndex / barsPerChord) % prog.length];
    // Before the drop: a lighter groove, then a 2-bar build (1 bar for lo-fi).
    const buildStart = drop - bar * (style === "lofi" ? 1 : 2);
    const build = t < drop && t >= buildStart;
    const groove = t < buildStart;
    const lastBarBeforeDrop = build && t >= drop - bar;
    const human = () => 0.85 + rand() * 0.15;

    // Harmony: a chord per bar (or two), filtered and quiet during the build.
    if (s === 0 && barIndex % barsPerChord === 0) {
      const sustain = bar * barsPerChord;
      const soft = build || groove;
      if (style === "lofi" || style === "afro") add({ t, inst: "keys", notes: chordNotes(chord), dur: sustain * 0.9, vel: soft ? 0.35 : 0.5 });
      else add({ t, inst: "pad", notes: chordNotes(chord, style === "cinematic" ? 12 : 24), dur: sustain, vel: soft ? 0.3 : 0.45 });
    }

    if (build) {
      // Sparse and filtered, then a roll in the last bar.
      if (lastBarBeforeDrop && style !== "lofi") {
        const roll = s >= 8 ? 1 : s % 2 === 0 ? 1 : 0;
        if (roll) add({ t, inst: style === "cinematic" ? "tom" : "snare", vel: 0.25 + 0.6 * (s / 16) });
      } else if (style === "lofi") {
        if (s === 0 || s === 10) add({ t, inst: "kick", vel: 0.45 });
        if (s === 4 || s === 12) add({ t, inst: "snare", vel: 0.3 });
      } else if (style === "afro") {
        add({ t, inst: "shaker", vel: (s % 4 === 2 ? 0.45 : 0.25) * human() });
      } else if (s % 4 === 0) {
        add({ t, inst: "hat", vel: 0.3 * human() });
      }
      continue;
    }

    // The groove is the full pattern at lower energy, without the 808 and lead.
    const g = groove ? 0.55 : 1;
    const full = !groove;
    const root = chord.root;
    switch (style) {
      case "phonk": {
        if (s === 0 || s === 6 || s === 10) {
          add({ t, inst: "kick", vel: 1 * g });
          if (full) add({ t, inst: "sub", notes: [root - 12 + (s === 10 ? 3 : 0)], dur: s === 0 ? step * 5.5 : step * 3.5, vel: 0.9, from: s === 6 ? root - 5 : undefined });
        }
        if (s === 8) add({ t, inst: "clap", vel: 0.9 * g });
        if (s % 2 === 0) add({ t, inst: "hat", vel: (s % 4 === 0 ? 0.5 : 0.35) * human() });
        const c = COWBELL[s];
        if (c >= 0 && full) add({ t, inst: "cowbell", notes: [root + 36 + PENTA[c]], vel: 0.55 * human() });
        break;
      }
      case "trap": {
        const kicks = barIndex % 2 === 0 ? [0, 7, 10] : [0, 3, 10, 14];
        if (kicks.includes(s)) {
          add({ t, inst: "kick", vel: 1 * g });
          if (full) add({ t, inst: "sub", notes: [root - 12], dur: step * 3, vel: 0.95, from: s === 10 ? root - 7 : undefined });
        }
        if (s === 8) add({ t, inst: "clap", vel: 1 * g });
        // 16th hats with a triplet-style roll near the end of every other bar.
        if (barIndex % 2 === 1 && s >= 12) {
          for (let r = 0; r < 3; r++) add({ t: t + (r * step) / 3, inst: "hat", vel: 0.35 + r * 0.1 });
        } else {
          add({ t, inst: "hat", vel: (s % 2 === 0 ? 0.45 : 0.28) * human() });
        }
        if (s === 14 && barIndex % 4 === 3) add({ t, inst: "openhat", vel: 0.4 });
        break;
      }
      case "afro": {
        if (s % 4 === 0) add({ t, inst: "kick", vel: 0.75 * g });
        add({ t, inst: "shaker", vel: (s % 4 === 2 ? 0.5 : 0.28) * human() });
        if (s === 3 || s === 11 || s === 14) add({ t, inst: "rim", vel: 0.45 });
        const logPattern: Record<number, number> = { 0: 0, 3: 7, 6: 12, 10: 7, 13: 3 };
        if (s in logPattern && full) add({ t, inst: "logdrum", notes: [root - 12 + logPattern[s]], vel: 0.8, from: s === 6 ? root - 12 + 7 : undefined });
        break;
      }
      case "cinematic": {
        if (s === 0 && barIndex % 2 === 0) if (full) add({ t, inst: "sub", notes: [root - 12], dur: bar * 1.5, vel: 0.8 });
        if ([0, 6, 8, 11].includes(s) && (full || s === 0)) add({ t, inst: "tom", vel: (s === 0 ? 1 : 0.65 * human()) * g });
        if (s === 8) add({ t, inst: "snare", vel: 0.7 });
        if (s % 4 === 2) add({ t, inst: "hat", vel: 0.22 });
        break;
      }
      case "lofi": {
        if (s === 0 || s === 7 || s === 10) add({ t: t + rand() * 0.01, inst: "kick", vel: 0.6 });
        if (s === 4 || s === 12) add({ t: t + 0.012, inst: "snare", vel: 0.45 });
        // Swung 8th hats.
        if (s % 2 === 0) add({ t: t + (s % 4 === 2 ? step * 0.3 : 0), inst: "hat", vel: 0.22 * human() });
        if (s === 0) if (full) add({ t, inst: "sub", notes: [root - 12], dur: bar * 0.9, vel: 0.5 });
        break;
      }
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { style, bpm, duration, dropAt: drop, events };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Synthesises a plan into stereo audio. Browser only (Web Audio API). */
export async function renderTrack(plan: TrackPlan, sampleRate = 44100): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(plan.duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  const noise = ctx.createBuffer(1, sampleRate * 2, sampleRate);
  const data = noise.getChannelData(0);
  const rand = seeded(7);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;

  const master = ctx.createGain();
  const fadeIn = Math.min(0.4, plan.duration / 4);
  const fadeOut = Math.min(1.5, plan.duration / 4);
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.9, fadeIn);
  master.gain.setValueAtTime(0.9, Math.max(fadeIn, plan.duration - fadeOut));
  master.gain.linearRampToValueAtTime(0, plan.duration);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;
  master.connect(comp).connect(ctx.destination);

  // Harmony runs through a filter that opens up at the drop.
  const music = ctx.createBiquadFilter();
  music.type = "lowpass";
  music.Q.value = 0.7;
  const drop = plan.dropAt;
  if (drop > 0) {
    music.frequency.setValueAtTime(500, 0);
    music.frequency.exponentialRampToValueAtTime(2500, Math.max(0.01, drop - 0.01));
    music.frequency.setValueAtTime(plan.style === "lofi" ? 3200 : 12000, drop);
  } else {
    music.frequency.setValueAtTime(plan.style === "lofi" ? 3200 : 12000, 0);
  }
  music.connect(master);

  const drive = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  const amount = plan.style === "phonk" ? 6 : plan.style === "trap" ? 3 : 1.5;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  drive.curve = curve;
  const driveOut = ctx.createGain();
  driveOut.gain.value = 0.7;
  drive.connect(driveOut).connect(master);

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseHit = (t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, out: AudioNode = master, attack = 0.002) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, attack, decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, rand() * 1.5);
    src.stop(t + attack + decay + 0.05);
  };
  const tone = (t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, attack: number, decay: number, out: AudioNode = master, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const g = ctx.createGain();
    env(g, t, peak, attack, decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  };

  for (const e of plan.events) {
    const v = e.vel;
    switch (e.inst) {
      case "kick":
        tone(e.t, "sine", 160, 42, 0.11, v, 0.002, 0.42);
        noiseHit(e.t, "highpass", 3000, 0.7, v * 0.15, 0.012);
        break;
      case "snare":
        noiseHit(e.t, "bandpass", 1900, 0.8, v * 0.7, 0.18);
        tone(e.t, "triangle", 200, 170, 0.05, v * 0.35, 0.001, 0.09);
        break;
      case "clap":
        for (const d of [0, 0.011, 0.023]) noiseHit(e.t + d, "bandpass", 1300, 1.2, v * 0.6, 0.03);
        noiseHit(e.t + 0.03, "bandpass", 1300, 1, v * 0.5, 0.16);
        break;
      case "hat":
        noiseHit(e.t, "highpass", 8000, 0.7, v * 0.4, 0.035);
        break;
      case "openhat":
        noiseHit(e.t, "highpass", 7500, 0.7, v * 0.35, 0.25);
        break;
      case "shaker":
        noiseHit(e.t, "bandpass", 6500, 1.2, v * 0.35, 0.05, master, 0.008);
        break;
      case "rim":
        tone(e.t, "square", 1700, 1700, 0, v * 0.18, 0.001, 0.03);
        noiseHit(e.t, "bandpass", 2500, 4, v * 0.25, 0.02);
        break;
      case "tom":
        tone(e.t, "sine", 120, 65, 0.25, v * 0.9, 0.002, 0.6);
        noiseHit(e.t, "lowpass", 600, 0.7, v * 0.4, 0.15);
        break;
      case "sub": {
        const f = hz(e.notes![0]);
        tone(e.t, "sine", e.from !== undefined ? hz(e.from) : f, f, 0.09, v * 0.9, 0.004, e.dur ?? 0.5, plan.style === "phonk" || plan.style === "trap" ? drive : master);
        break;
      }
      case "cowbell": {
        const f = hz(e.notes![0]);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f * 1.5;
        bp.Q.value = 1.5;
        bp.connect(drive);
        tone(e.t, "square", f, f, 0, v * 0.35, 0.002, 0.22, bp);
        tone(e.t, "square", f * 1.48, f * 1.48, 0, v * 0.25, 0.002, 0.18, bp);
        break;
      }
      case "logdrum": {
        const f = hz(e.notes![0]);
        tone(e.t, "sine", e.from !== undefined ? hz(e.from) : f * 1.6, f, 0.05, v * 0.9, 0.003, 0.38, drive);
        tone(e.t, "triangle", f * 2, f * 2, 0, v * 0.15, 0.003, 0.2);
        break;
      }
      case "pad":
        for (const n of e.notes ?? []) {
          for (const d of [-9, 9]) {
            const o = ctx.createOscillator();
            o.type = "sawtooth";
            o.frequency.value = hz(n);
            o.detune.value = d;
            const g = ctx.createGain();
            const dur = e.dur ?? 2;
            g.gain.setValueAtTime(0, e.t);
            g.gain.linearRampToValueAtTime(v * 0.05, e.t + Math.min(0.4, dur / 3));
            g.gain.setValueAtTime(v * 0.05, e.t + dur * 0.8);
            g.gain.linearRampToValueAtTime(0, e.t + dur);
            o.connect(g).connect(music);
            o.start(e.t);
            o.stop(e.t + dur + 0.05);
          }
        }
        break;
      case "keys":
        for (const n of e.notes ?? []) {
          tone(e.t, "sine", hz(n), hz(n), 0, v * 0.12, 0.008, e.dur ?? 1.5, music);
          tone(e.t, "triangle", hz(n) * 2, hz(n) * 2, 0, v * 0.03, 0.008, (e.dur ?? 1.5) * 0.5, music);
        }
        break;
      case "riser": {
        const dur = Math.max(0.2, e.dur ?? 2);
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 2;
        f.frequency.setValueAtTime(300, e.t);
        f.frequency.exponentialRampToValueAtTime(7000, e.t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, e.t);
        g.gain.exponentialRampToValueAtTime(v * 0.5, e.t + dur);
        g.gain.setValueAtTime(0, e.t + dur);
        src.connect(f).connect(g).connect(master);
        src.start(e.t);
        src.stop(e.t + dur + 0.01);
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(180, e.t);
        o.frequency.exponentialRampToValueAtTime(1100, e.t + dur);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, e.t);
        og.gain.exponentialRampToValueAtTime(v * 0.05, e.t + dur);
        og.gain.setValueAtTime(0, e.t + dur);
        o.connect(og).connect(music);
        o.start(e.t);
        o.stop(e.t + dur + 0.01);
        break;
      }
      case "impact":
        tone(e.t, "sine", 75, 28, 1.4, v, 0.003, 2.4);
        noiseHit(e.t, "lowpass", 380, 0.7, v * 0.8, 0.9);
        break;
      case "crash":
        noiseHit(e.t, "highpass", 5000, 0.5, v * 0.35, 1.8);
        break;
      case "vinyl": {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 2500;
        f.Q.value = 0.5;
        const g = ctx.createGain();
        g.gain.value = v * 0.02;
        src.connect(f).connect(g).connect(master);
        src.start(e.t);
        src.stop(e.t + (e.dur ?? plan.duration));
        break;
      }
    }
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV from channel data. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const bytes = new Uint8Array(44 + frames * count * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
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
    for (let c = 0; c < count; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return bytes;
}

/** Composes and renders a track as WAV bytes. Browser only. */
export async function composeWav(style: MusicStyle, duration: number, dropAt: number, seed = 1, pause?: number): Promise<Uint8Array> {
  const buffer = await renderTrack(planTrack(style, duration, dropAt, seed, pause));
  return encodeWav([buffer.getChannelData(0), buffer.getChannelData(1)], buffer.sampleRate);
}
