/**
 * Transitions between stitched segments. A transition overlaps the end of one
 * segment with the start of the next (FFmpeg xfade + acrossfade), so the
 * output is shorter than the segments laid end to end; everything that maps
 * source time to output time (captions, the music drop, the progress bar)
 * goes through `outputStarts` / `outputDuration` here.
 */
import type { ExportItem } from "./types";

/** FFmpeg xfade transition names this app uses. */
export type TransitionType = "fadewhite" | "fade" | "fadeblack" | "smoothleft" | "zoomin" | "circleopen" | "hblur";

export interface Transition {
  type: TransitionType;
  /** Seconds of overlap. */
  duration: number;
}

export const TRANSITIONS: { id: TransitionType; label: string; hint: string; duration: number }[] = [
  { id: "fadewhite", label: "Flash", hint: "A white flash cut: punchy, for action", duration: 0.25 },
  { id: "smoothleft", label: "Whip", hint: "A fast slide, like a whip pan", duration: 0.3 },
  { id: "zoomin", label: "Zoom", hint: "Zooms into the next shot: hype and reveals", duration: 0.35 },
  { id: "hblur", label: "Blur", hint: "A motion-blur blend: smooth and dreamy", duration: 0.4 },
  { id: "fade", label: "Dissolve", hint: "A soft cross-fade: emotional moments", duration: 0.6 },
  { id: "fadeblack", label: "Dip to black", hint: "Fades through black: endings and time jumps", duration: 0.6 },
  { id: "circleopen", label: "Iris", hint: "A circle opens on the next shot", duration: 0.45 },
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Seconds each item overlaps the one before it (0 for the first item and for
 * hard cuts). Capped at a third of either side so a short segment is never
 * swallowed by its transitions.
 */
export function overlaps(items: Pick<ExportItem, "start" | "end" | "transitionIn">[]): number[] {
  return items.map((item, i) => {
    if (i === 0 || !item.transitionIn) return 0;
    const prev = items[i - 1];
    return r3(Math.max(0, Math.min(item.transitionIn.duration, (prev.end - prev.start) / 3, (item.end - item.start) / 3)));
  });
}

/** When each item starts in the output. */
export function outputStarts(items: Pick<ExportItem, "start" | "end" | "transitionIn">[]): number[] {
  const o = overlaps(items);
  const starts: number[] = [];
  let t = 0;
  items.forEach((item, i) => {
    t -= o[i];
    starts.push(r3(t));
    t += item.end - item.start;
  });
  return starts;
}

/** Length of the output once transitions overlap their neighbours. */
export function outputDuration(items: Pick<ExportItem, "start" | "end" | "transitionIn">[]): number {
  const o = overlaps(items);
  return r3(items.reduce((sum, item, i) => sum + item.end - item.start - o[i], 0));
}

export const hasTransitions = (items: Pick<ExportItem, "transitionIn">[]) => items.some((item, i) => i > 0 && Boolean(item.transitionIn));

/**
 * The browser's FFmpeg (5.1) deadlocks on transition graphs with more than
 * this many video inputs, so longer runs are rendered in chunks.
 */
export const MAX_TRANSITION_INPUTS = 3;

/**
 * Splits items into chunks of at most `size`, each rendered on its own with
 * the transitions inside it, plus the transition into each chunk for the pass
 * that joins them. Durations are the already-capped overlaps, so the joined
 * result has exactly the timing of rendering everything at once.
 */
export function chunkTransitions<T extends Pick<ExportItem, "start" | "end" | "transitionIn">>(
  items: T[],
  size = MAX_TRANSITION_INPUTS,
): { chunks: T[][]; joins: (Transition | undefined)[] } {
  const o = overlaps(items);
  const exact = (item: T, i: number): T => {
    const t = item.transitionIn;
    return { ...item, transitionIn: t && o[i] > 0 ? { type: t.type, duration: o[i] } : undefined };
  };
  const chunks: T[][] = [];
  const joins: (Transition | undefined)[] = [];
  for (let k = 0; k < items.length; k += size) {
    chunks.push(items.slice(k, k + size).map((item, j) => (j === 0 ? { ...item, transitionIn: undefined } : exact(item, k + j))));
    joins.push(k > 0 ? exact(items[k], k).transitionIn : undefined);
  }
  return { chunks, joins };
}
