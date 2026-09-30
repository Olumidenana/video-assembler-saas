/**
 * Auto-edit: turns per-clip loudness/motion measurements into segments.
 * Pure functions: no FFmpeg, no DOM, fully unit-tested.
 */
import { BIN_SECONDS, type ClipAnalysis, SILENCE_DB } from "./analysis";

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
function rawScores(a: ClipAnalysis): number[] {
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
 * Picks the best moments across all clips until they add up to the target
 * length, then returns them in source order (clip order, then time), so the
 * story still flows.
 *
 * 1. Rank every half-second by its smoothed score and take the best ones until
 *    the target is reached (smoothing favours sustained moments over blips).
 * 2. Join picks that sit within a second of each other into one cut.
 * 3. Stretch cuts shorter than 2 s toward their better-scoring side, so no cut
 *    is a jarring flash.
 */
export function pickHighlights(clips: AnalyzedClip[], { targetSeconds }: HighlightOptions): Range[] {
  const total = clips.reduce((sum, c) => sum + c.duration, 0);
  if (clips.length === 0 || total === 0) return [];
  if (targetSeconds >= total - BIN_SECONDS) {
    return clips.map((c) => ({ clipId: c.clipId, start: 0, end: round(c.duration) }));
  }

  const scored = clips.map((c) => ({
    ...c,
    smooth: scoreClip(c.analysis),
    raw: rawScores(c.analysis),
    picked: new Array<boolean>(c.analysis.motion.length).fill(false),
  }));

  const ranked = scored
    .flatMap((c, ci) => c.smooth.map((score, bin) => ({ ci, bin, score })))
    .sort((a, b) => b.score - a.score);
  const wanted = Math.max(1, Math.round(targetSeconds / BIN_SECONDS));
  for (const { ci, bin } of ranked.slice(0, wanted)) scored[ci].picked[bin] = true;

  const minBins = Math.min(wanted, Math.round(2 / BIN_SECONDS));
  const ranges: Range[] = [];
  for (const c of scored) {
    const bins = c.picked.length;
    // Contiguous runs of picked bins, joined across gaps of up to 1 s.
    const runs: [number, number][] = [];
    c.picked.forEach((on, i) => {
      if (!on) return;
      const last = runs[runs.length - 1];
      if (last && i - last[1] <= 1 / BIN_SECONDS + 1) last[1] = i;
      else runs.push([i, i]);
    });
    for (const run of runs) {
      let [lo, hi] = run;
      while (hi - lo + 1 < minBins && (lo > 0 || hi < bins - 1)) {
        const left = lo > 0 ? c.raw[lo - 1] : -1;
        const right = hi < bins - 1 ? c.raw[hi + 1] : -1;
        if (right >= left) hi++;
        else lo--;
      }
      ranges.push({
        clipId: c.clipId,
        start: round(lo * BIN_SECONDS),
        end: round(Math.min(c.duration, (hi + 1) * BIN_SECONDS)),
      });
    }
  }
  return mergeClose(ranges, 0.01);
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
