import type { ClipAnalysis } from "@/lib/video/analysis";
import { autoTarget, pickHighlights, removeSilences, type Range } from "@/lib/video/highlights";
import { timelineReducer, type TimelineState } from "@/lib/video/timeline";
import type { EditorAction } from "./actions";

/** Actions that need every clip analysed first. */
export const needsAnalysis = (actions: EditorAction[]) =>
  actions.some((a) => a.type === "highlights" || a.type === "remove_silence");

/**
 * Applies edit actions to a copy of the timeline and returns the resulting
 * segments. Exports are not performed here; the caller handles them.
 * Uses the same reducer as the manual controls, so both behave identically.
 */
export function applyActions(
  initial: TimelineState,
  actions: EditorAction[],
  analyses: Map<string, ClipAnalysis>,
): Range[] {
  let state = initial;
  const clipOrder = Object.keys(initial.clips);
  const segmentAt = (n: number | null) => (n === null ? undefined : state.segments[n - 1]);
  const replace = (ranges: Range[]) => {
    state = timelineReducer(state, { type: "replaceSegments", segments: ranges });
  };

  actions.forEach((action, step) => {
    switch (action.type) {
      case "reset":
        replace(clipOrder.map((clipId) => ({ clipId, start: 0, end: initial.clips[clipId].info.duration })));
        break;

      case "highlights":
      case "remove_silence": {
        // A highlight searches the full original videos (so asking for a longer
        // reel after a shorter one works), unless an earlier step in the same
        // command already shaped the timeline ("remove silences, then highlight").
        // Silence removal always refines what's there, keeping manual trims.
        if (action.type === "highlights" && step === 0) {
          replace(clipOrder.map((clipId) => ({ clipId, start: 0, end: initial.clips[clipId].info.duration })));
        }
        // Each segment is treated as its own mini-clip.
        const sources = state.segments.flatMap((s) => {
          const analysis = analyses.get(s.clipId);
          return analysis ? [{ segment: s, analysis: sliceAnalysis(analysis, s.start, s.end) }] : [];
        });
        const pieces = sources.map(({ segment }, i) => ({
          clipId: String(i),
          duration: segment.end - segment.start,
          analysis: sources[i].analysis,
        }));
        const total = pieces.reduce((sum, p) => sum + p.duration, 0);
        const picked =
          action.type === "highlights"
            ? pickHighlights(pieces, { targetSeconds: action.seconds ?? autoTarget(total) })
            : removeSilences(pieces);
        if (picked.length === 0) break;
        replace(
          picked.map((r) => {
            const seg = sources[Number(r.clipId)].segment;
            return { clipId: seg.clipId, start: seg.start + r.start, end: Math.min(seg.end, seg.start + r.end) };
          }),
        );
        break;
      }

      case "split_every": {
        const targets = action.segment === null ? state.segments.map((s) => s.id) : [segmentAt(action.segment)?.id];
        for (const id of targets) if (id) state = timelineReducer(state, { type: "splitEvery", id, seconds: action.seconds });
        break;
      }

      case "cut": {
        const first = action.segment === null ? state.segments[0] : segmentAt(action.segment);
        const last = action.segment === null ? state.segments[state.segments.length - 1] : first;
        if (first && action.fromStart) state = timelineReducer(state, { type: "setRange", id: first.id, start: first.start + action.fromStart });
        const lastNow = last && state.segments.find((s) => s.id === last.id);
        if (lastNow && action.fromEnd) state = timelineReducer(state, { type: "setRange", id: lastNow.id, end: lastNow.end - action.fromEnd });
        break;
      }

      case "keep_range": {
        const seg = segmentAt(action.segment);
        if (seg) state = timelineReducer(state, { type: "setRange", id: seg.id, start: action.start, end: action.end });
        break;
      }

      case "remove_segment": {
        const seg = segmentAt(action.segment);
        // Keep the video itself available (for "reset" or later actions), even
        // when its last segment goes.
        if (seg && state.segments.length > 1) {
          state = { ...timelineReducer(state, { type: "removeSegment", id: seg.id }), clips: initial.clips };
        }
        break;
      }

      case "move_segment": {
        const seg = segmentAt(action.segment);
        if (!seg) break;
        const target = Math.min(Math.max(action.to, 1), state.segments.length) - 1;
        let index = action.segment - 1;
        while (index !== target) {
          const delta = index < target ? 1 : -1;
          state = timelineReducer(state, { type: "move", id: seg.id, delta });
          index += delta;
        }
        break;
      }

      case "export":
        break;
    }
  });
  return state.segments.map(({ clipId, start, end }) => ({ clipId, start, end }));
}

/** The part of a clip's analysis that covers [start, end). */
function sliceAnalysis(a: ClipAnalysis, start: number, end: number): ClipAnalysis {
  const from = Math.floor(start / 0.5);
  const to = Math.max(from + 1, Math.ceil(end / 0.5));
  return {
    loudness: a.loudness.slice(from, to),
    motion: a.motion.slice(from, to),
    cuts: a.cuts.slice(from, to),
    hasAudio: a.hasAudio,
  };
}
