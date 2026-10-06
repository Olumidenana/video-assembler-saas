/**
 * Auto-edit: turns per-clip loudness/motion measurements into segments.
 * Pure functions: no FFmpeg, no DOM, fully unit-tested.
 */
import { BIN_SECONDS, type ClipAnalysis, SILENCE_DB } from "./analysis";
import { outputDuration, outputStarts } from "./transitions";
import type { ExportItem } from "./types";

export interface AnalyzedClip {
  clipId: string;
  duration: number;
  analysis: ClipAnalysis;
}

export interface Range {
  clipId: string;
  start: number;
  end: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))))];
}

/** Maps values to 0..1 between the clip's 10th and 95th percentiles. */
function normalize(values: number[]): number[] {
  const lo = percentile(values, 10);
  const hi = percentile(values, 95);
  if (hi - lo < 1e-6) return values.map(() => 0);
  return values.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      sum += values[j];
      n++;
    }
    return sum / n;
  });
}

/**
 * "Interestingness" per bin, 0..1. Loud moments (speech, music drops,
 * reactions) weigh most; on-screen movement adds to it. The frame difference
 * at a hard cut is a spike from the cut itself, not action, so it is replaced
 * with its neighbours' level.
 */
export function scoreClip(a: ClipAnalysis): number[] {
  return smooth(rawScores(a), 2);
}

/** Per-bin scores without smoothing; used to place cut boundaries precisely. */
export function rawScores(a: ClipAnalysis): number[] {
  const motion = a.motion.map((m, i) =>
    a.cuts[i] > 0.3 ? Math.min(a.motion[i - 1] ?? 0, a.motion[i + 1] ?? 0, m) : m,
  );
  const motionN = normalize(motion);
  if (!a.hasAudio) return motionN;
  // Absolute loudness matters too: -60 dB "peaks" in a silent clip aren't highlights.
  const loud = a.loudness.map((db) => Math.max(SILENCE_DB, db));
  const loudRel = normalize(loud);
  const loudAbs = loud.map((db) => Math.min(1, Math.max(0, (db + 55) / 40)));
  const loudN = loudRel.map((r, i) => 0.6 * r + 0.4 * loudAbs[i]);
  return loudN.map((l, i) => 0.65 * l + 0.35 * motionN[i]);
}

export interface HighlightOptions {
  /** Desired total length of the highlight reel, in seconds. */
  targetSeconds: number;
}

/** Suggested reel length when the user picks "Auto": ~20% of the footage, 10–90 s. */
export function autoTarget(totalSeconds: number): number {
  return Math.round(Math.min(90, Math.max(10, totalSeconds * 0.2)));
}

/**
 * Builds a highlight reel from whole moments (see findMoments), never from
 * scattered half-seconds: the best few scenes until the target length, the
 * last one trimmed around its peak to fit, returned in source order so the
 * story still flows. Moments much weaker than the best are left out, so a
 * reel can come out a little short rather than padded with filler.
 */
export function pickHighlights(clips: AnalyzedClip[], { targetSeconds }: HighlightOptions): Range[] {
  const total = clips.reduce((sum, c) => sum + c.duration, 0);
  if (clips.length === 0 || total === 0) return [];
  if (targetSeconds >= total - BIN_SECONDS) {
    return clips.map((c) => ({ clipId: c.clipId, start: 0, end: round(c.duration) }));
  }

  // Short reels use short moments; longer reels get a few proper scenes.
  const maxSeconds = Math.min(20, Math.max(4, targetSeconds / 2));
  const minSeconds = Math.min(maxSeconds, Math.max(3, Math.min(8, targetSeconds / 5)));
  const moments = clips
    .flatMap((c) => findMoments(c.clipId, c.duration, c.analysis, { minSeconds, maxSeconds, maxMoments: 40 }))
    .sort((a, b) => b.score - a.score);
  if (moments.length === 0) {
    const first = clips[0];
    return [{ clipId: first.clipId, start: 0, end: round(Math.min(first.duration, targetSeconds)) }];
  }

  const picked: Range[] = [];
  let sum = 0;
  for (const m of moments) {
    const room = targetSeconds - sum;
    if (room < 2 || m.score < moments[0].score * 0.5) break;
    let { start, end } = m;
    if (end - start > room + 0.5) {
      // Keep the part around the peak that fits.
      start = Math.min(Math.max(m.peak - room / 2, m.start), m.end - room);
      end = start + room;
    }
    picked.push({ clipId: m.clipId, start: round(start), end: round(end) });
    sum += end - start;
  }
  const order = new Map(clips.map((c, i) => [c.clipId, i]));
  picked.sort((a, b) => order.get(a.clipId)! - order.get(b.clipId)! || a.start - b.start);
  // Neighbouring moments play as one scene rather than with a jarring 1–2 s jump.
  return mergeClose(picked, 2.5);
}

/** A stretch of one clip that works on its own, with what makes it watchable (each 0..1). */
export interface Moment {
  clipId: string;
  start: number;
  end: number;
  /** Time of the strongest point, in seconds. */
  peak: number;
  signals: {
    /** Energy in the first 3 seconds. */
    hook: number;
    /** Energy rising from the first half to the second (anticipation). */
    build: number;
    /** Height of the biggest moment. */
    peak: number;
    /** Average energy throughout. */
    intensity: number;
    /** How often the shot changes. */
    pacing: number;
  };
  /** The peak lands after the opening and before the very end (a payoff, not a cut mid-action). */
  arc: boolean;
  /** Starts and ends on scene changes. */
  clean: boolean;
  score: number;
}

export interface MomentOptions {
  minSeconds: number;
  maxSeconds: number;
  maxMoments: number;
  /** Signal weights (hook, curiosity = build-up, emotion = peak, value = intensity, pacing); audience playbooks tune these. */
  weights?: { hook: number; curiosity: number; emotion: number; value: number; pacing: number };
  /**
   * Look for the quiet ones instead: slow, still, but not silent (a voice or a
   * score playing), with feeling that swells. For emotional edits.
   */
  calm?: boolean;
}

const CUT_THRESHOLD = 0.3;
/** Opening/ending theme songs: this long or longer, in bins (60 s). */
const THEME_MIN_BINS = 120;
const THEME_MAX_BINS = 220;

/** Bins containing a hard cut (at most one per second). */
export function cutBins(a: ClipAnalysis): number[] {
  const out: number[] = [];
  a.cuts.forEach((c, i) => {
    if (c > CUT_THRESHOLD && (out.length === 0 || i - out[out.length - 1] >= 2)) out.push(i);
  });
  return out;
}

export function cutsPerMinute(a: ClipAnalysis): number {
  const minutes = (a.cuts.length * BIN_SECONDS) / 60;
  return minutes > 0 ? cutBins(a).length / minutes : 0;
}

/**
 * Finds opening/ending theme songs in long videos (episodes): a minute or
 * more of steady, loud sound with no pauses, near the start or the end.
 * Speech and sound effects rise and fall; mastered music doesn't. Without
 * this, a theme song (loud, fast cuts) would always look like the best part.
 * Returns [startBin, endBin) ranges.
 */
export function themeSongRanges(a: ClipAnalysis): [number, number][] {
  const n = a.loudness.length;
  if (!a.hasAudio || n * BIN_SECONDS < 8 * 60) return [];
  const median = percentile(a.loudness.filter((db) => db > SILENCE_DB), 50);
  const steady = (from: number, to: number) => {
    const w = a.loudness.slice(from, to);
    const mean = w.reduce((s, v) => s + v, 0) / w.length;
    const std = Math.sqrt(w.reduce((s, v) => s + (v - mean) ** 2, 0) / w.length);
    const loudShare = w.filter((v) => v >= median).length / w.length;
    const dips = w.filter((v) => v < mean - 10).length;
    return { mean, std, ok: std < 3.5 && loudShare > 0.85 && dips <= 2 };
  };

  const out: [number, number][] = [];
  const zones: [number, number][] = [
    [0, Math.floor(n * 0.3)],
    [Math.floor(n * 0.7), n],
  ];
  for (const [z0, z1] of zones) {
    let best: { s: number; std: number; mean: number } | null = null;
    for (let s = z0; s + THEME_MIN_BINS <= z1; s += 4) {
      const w = steady(s, s + THEME_MIN_BINS);
      if (w.ok && (!best || w.std < best.std)) best = { s, std: w.std, mean: w.mean };
    }
    if (!best) continue;
    // Grow to the whole song: neighbours at the same level, without dips.
    const near = (i: number) => Math.abs(a.loudness[i] - best.mean) < 6;
    let lo = best.s;
    let hi = best.s + THEME_MIN_BINS;
    while (lo > 0 && near(lo - 1) && hi - lo < THEME_MAX_BINS) lo--;
    while (hi < n && near(hi) && hi - lo < THEME_MAX_BINS) hi++;
    out.push([lo, hi]);
  }
  return out;
}

/**
 * Scene-aware moment finder for any footage, with or without speech (anime,
 * films, gaming, sports, skits). Candidates start and end on hard cuts when
 * the video has them (else on a 1–2 s grid) and are scored on what keeps
 * people watching: a strong opening, energy that builds, a big peak that
 * lands before the end, sustained intensity and editing pace. Theme songs are
 * skipped. Returns the best non-overlapping moments, best first.
 */
export function findMoments(clipId: string, duration: number, a: ClipAnalysis, opts: MomentOptions): Moment[] {
  const n = a.motion.length;
  const minB = Math.max(1, Math.ceil(opts.minSeconds / BIN_SECONDS));
  const maxB = Math.max(minB, Math.floor(opts.maxSeconds / BIN_SECONDS));
  if (n < minB) return [];

  const raw = rawScores(a);
  const sm = smooth(raw, 1);
  const cuts = cutBins(a);
  const cutSet = new Set(cuts);
  // Edited footage (2+ cuts a minute) is cut on shot changes; a cut bin's
  // successor is the first bin wholly in the new shot.
  const useCuts = cuts.length >= ((n * BIN_SECONDS) / 60) * 2;
  const step = n > 4000 ? 4 : 2;
  const grid = [...Array.from({ length: Math.floor(n / step) + 1 }, (_, i) => i * step).filter((b) => b < n), n];
  // Calm scenes hold long shots, often longer than the moment: cut inside them on the grid too.
  const bounds = useCuts
    ? [...new Set([0, ...cuts.map((c) => c + 1), n, ...(opts.calm ? grid : [])])].filter((b) => b <= n).sort((x, y) => x - y)
    : grid;

  const blocked = new Uint8Array(n);
  // Theme songs, plus 2 s either side so no clip opens or ends on their last notes.
  for (const [lo, hi] of themeSongRanges(a)) blocked.fill(1, Math.max(0, lo - 4), Math.min(n, hi + 4));
  const sum = (arr: ArrayLike<number>) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + arr[i];
    return p;
  };
  const P = sum(raw);
  const B = sum(blocked);
  const C = sum(Array.from({ length: n }, (_, i) => (cutSet.has(i) ? 1 : 0)));
  // Bins with sound in them (speech, score), for calm moments that still say something.
  const A = sum(Array.from({ length: n }, (_, i) => (a.hasAudio && a.loudness[i] > -45 ? 1 : 0)));
  const avg = (s: number, e: number) => (e > s ? (P[e] - P[s]) / (e - s) : 0);

  const candidates: Moment[] = [];
  for (let si = 0; si < bounds.length; si++) {
    const s = bounds[si];
    for (let sj = si + 1; sj < bounds.length; sj++) {
      const e = bounds[sj];
      const len = e - s;
      if (len < minB) continue;
      if (len > maxB) break;
      if (B[e] - B[s] > 0) continue;

      let max = -1;
      for (let k = s; k < e; k++) max = Math.max(max, sm[k]);
      let first = -1;
      let last = -1;
      for (let k = s; k < e; k++) {
        if (sm[k] >= max - 0.02) {
          if (first < 0) first = k;
          last = k;
        }
      }
      const peakBin = (first + last) / 2;
      const peakPos = (peakBin - s) / len;
      const half = s + Math.floor(len / 2);
      const hook = avg(s, s + Math.min(6, len));
      const build = Math.min(1, Math.max(0, 0.5 + (avg(half, e) - avg(s, half))));
      const intensity = avg(s, e);
      const pacing = Math.min(1, (C[e] - C[s]) / (len * BIN_SECONDS) / 0.4);
      const arc = peakPos >= 0.2 && peakPos <= 0.92;
      const w = opts.weights ?? { hook: 0.28, curiosity: 0.18, emotion: 0.24, value: 0.18, pacing: 0.12 };
      const base = opts.calm
        ? 0.35 * (1 - intensity) + 0.25 * (1 - pacing) + 0.2 * build + 0.2 * (A[e] - A[s]) / len
        : w.hook * hook + w.curiosity * build + w.emotion * max + w.value * intensity + w.pacing * pacing;
      const score = base * (arc || opts.calm ? 1 : 0.85) * (0.92 + 0.08 * (len / maxB));
      candidates.push({
        clipId,
        start: round(s * BIN_SECONDS),
        end: round(Math.min(duration, e * BIN_SECONDS)),
        peak: round((peakBin + 0.5) * BIN_SECONDS),
        signals: { hook, build, peak: max, intensity, pacing },
        arc,
        clean: useCuts,
        score,
      });
    }
  }

  const picked: Moment[] = [];
  for (const c of candidates.sort((x, y) => y.score - x.score)) {
    if (picked.length >= opts.maxMoments) break;
    if (picked.some((p) => c.start < p.end + 1 && p.start < c.end + 1)) continue;
    picked.push(c);
  }
  return picked;
}

export interface SilenceOptions {
  /** Keep this much audio around each spoken part so words aren't clipped. */
  padSeconds?: number;
  /** Drop quiet gaps shorter than this; natural pauses keep the rhythm. */
  minGapSeconds?: number;
}

/**
 * Keeps the parts of each clip with sound in them. The silence threshold adapts
 * to the clip: a few dB above its own noise floor, never below -50 dBFS.
 * Clips without an audio track are kept whole.
 */
export function removeSilences(clips: AnalyzedClip[], { padSeconds = 0.25, minGapSeconds = 0.75 }: SilenceOptions = {}): Range[] {
  const ranges: Range[] = [];
  for (const { clipId, duration, analysis } of clips) {
    if (!analysis.hasAudio) {
      ranges.push({ clipId, start: 0, end: round(duration) });
      continue;
    }
    const levels = analysis.loudness;
    const floor = percentile(levels.filter((db) => db > SILENCE_DB), 10);
    const peak = percentile(levels, 95);
    const threshold = Math.max(-50, Math.min(peak - 10, floor + 8));

    const own: Range[] = [];
    let open: number | null = null;
    levels.forEach((db, i) => {
      const loud = db > threshold;
      if (loud && open === null) open = i;
      if ((!loud || i === levels.length - 1) && open !== null) {
        const endBin = loud ? i + 1 : i;
        own.push({
          clipId,
          start: round(Math.max(0, open * BIN_SECONDS - padSeconds)),
          end: round(Math.min(duration, endBin * BIN_SECONDS + padSeconds)),
        });
        open = null;
      }
    });
    ranges.push(...mergeClose(own, minGapSeconds).filter((r) => r.end - r.start >= 0.5));
  }
  return ranges;
}

/** Joins ranges of the same clip whose gap is smaller than `gap` seconds. Input must be sorted. */
export function mergeClose(ranges: Range[], gap: number): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && last.clipId === r.clipId && r.start - last.end < gap) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * Where the strongest moment arrives in an export's output timeline (seconds),
 * for lining up a music drop with it. Energy (loudness + motion) is measured
 * relative to this output only, without the clip-wide cap scoreClip uses, so
 * a rising fight peaks at its real climax; the drop goes where the energy
 * first gets near that peak. Skips the first and last second and a half so
 * the build-up and outro have room. Without analyses, a quarter of the way in.
 */
export function outputPeak(items: Pick<ExportItem, "clipId" | "start" | "end" | "transitionIn" | "speed">[], analyses: Map<string, ClipAnalysis>): number {
  const total = outputDuration(items);
  const starts = outputStarts(items);
  const fallback = Math.round(Math.min(2, total / 4) * 100) / 100;
  const points: { t: number; loud: number; motion: number }[] = [];
  for (const [i, item] of items.entries()) {
    const offset = starts[i];
    const a = analyses.get(item.clipId);
    if (a) {
      for (let bin = Math.floor(item.start / BIN_SECONDS); bin * BIN_SECONDS < item.end && bin < a.motion.length; bin++) {
        points.push({
          t: offset + Math.max(0, bin * BIN_SECONDS - item.start) / (item.speed ?? 1),
          loud: a.hasAudio ? Math.max(SILENCE_DB, a.loudness[bin] ?? SILENCE_DB) : 0,
          motion: a.cuts[bin] > 0.3 ? 0 : a.motion[bin],
        });
      }
    }
  }
  points.sort((x, y) => x.t - y.t);
  if (points.length < 4) return fallback;
  const scale = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.map((v) => (hi - lo < 1e-6 ? 0 : (v - lo) / (hi - lo)));
  };
  const hasAudio = points.some((p) => p.loud !== 0);
  const loud = scale(points.map((p) => p.loud));
  const motion = scale(points.map((p) => p.motion));
  const energy = smooth(points.map((_, i) => (hasAudio ? 0.65 * loud[i] + 0.35 * motion[i] : motion[i])), 2);

  const lo = Math.min(1.5, total * 0.15);
  const hi = Math.max(lo, total - 1.5);
  const inRange = points.map((p, i) => ({ t: p.t, e: energy[i] })).filter((p) => p.t >= lo && p.t <= hi);
  if (inRange.length === 0) return fallback;
  const best = Math.max(...inRange.map((p) => p.e));
  const at = inRange.find((p) => p.e >= best - 0.08)!.t;
  return Math.round(at * 100) / 100;
}
