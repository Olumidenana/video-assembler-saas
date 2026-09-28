import { MIN_SEGMENT_SECONDS } from "./commands";
import type { Clip, ExportItem, Segment } from "./types";

export interface TimelineState {
  clips: Record<string, Clip>;
  segments: Segment[];
  selectedId: string | null;
}

export type TimelineAction =
  | { type: "addClip"; clip: Clip }
  | { type: "removeSegment"; id: string }
  | { type: "move"; id: string; delta: -1 | 1 }
  | { type: "setRange"; id: string; start?: number; end?: number }
  | { type: "split"; id: string; at: number }
  | { type: "splitEvery"; id: string; seconds: number }
  | { type: "select"; id: string };

export const initialTimeline: TimelineState = { clips: {}, segments: [], selectedId: null };

/** Upper bound for "split into parts" so a typo can't create thousands of segments. */
export const MAX_PARTS = 200;

const newId = () => crypto.randomUUID();
const round = (n: number) => Math.round(n * 1000) / 1000;

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case "addClip": {
      const segment: Segment = { id: newId(), clipId: action.clip.id, start: 0, end: action.clip.info.duration };
      return {
        clips: { ...state.clips, [action.clip.id]: action.clip },
        segments: [...state.segments, segment],
        selectedId: state.selectedId ?? segment.id,
      };
    }

    case "removeSegment": {
      const index = state.segments.findIndex((s) => s.id === action.id);
      if (index === -1) return state;
      const removed = state.segments[index];
      const segments = state.segments.filter((s) => s.id !== action.id);
      const clips = { ...state.clips };
      if (!segments.some((s) => s.clipId === removed.clipId)) delete clips[removed.clipId];
      const selectedId =
        state.selectedId === action.id
          ? (segments[Math.min(index, segments.length - 1)]?.id ?? null)
          : state.selectedId;
      return { clips, segments, selectedId };
    }

    case "move": {
      const index = state.segments.findIndex((s) => s.id === action.id);
      const target = index + action.delta;
      if (index === -1 || target < 0 || target >= state.segments.length) return state;
      const segments = [...state.segments];
      [segments[index], segments[target]] = [segments[target], segments[index]];
      return { ...state, segments };
    }

    case "setRange": {
      return mapSegment(state, action.id, (seg, clip) => {
        const duration = clip.info.duration;
        let start = action.start ?? seg.start;
        let end = action.end ?? seg.end;
        start = clamp(round(start), 0, duration - MIN_SEGMENT_SECONDS);
        end = clamp(round(end), MIN_SEGMENT_SECONDS, duration);
        // Keep the range valid by moving the edge the user didn't touch.
        if (end - start < MIN_SEGMENT_SECONDS) {
          if (action.start !== undefined) end = Math.min(duration, start + MIN_SEGMENT_SECONDS);
          else start = Math.max(0, end - MIN_SEGMENT_SECONDS);
        }
        return [{ ...seg, start, end }];
      });
    }

    case "split": {
      return mapSegment(state, action.id, (seg) => {
        const at = round(action.at);
        if (at - seg.start < MIN_SEGMENT_SECONDS || seg.end - at < MIN_SEGMENT_SECONDS) return [seg];
        return [
          { ...seg, end: at },
          { id: newId(), clipId: seg.clipId, start: at, end: seg.end },
        ];
      });
    }

    case "splitEvery": {
      return mapSegment(state, action.id, (seg) => {
        const length = seg.end - seg.start;
        const size = Math.max(action.seconds, length / MAX_PARTS, MIN_SEGMENT_SECONDS);
        if (length <= size) return [seg];
        const parts: Segment[] = [];
        for (let start = seg.start; seg.end - start >= MIN_SEGMENT_SECONDS; start = round(start + size)) {
          parts.push({
            id: parts.length === 0 ? seg.id : newId(),
            clipId: seg.clipId,
            start,
            end: round(Math.min(seg.end, start + size)),
          });
        }
        // Fold a tiny remainder into the previous part instead of leaving a sliver.
        const last = parts[parts.length - 1];
        if (parts.length > 1 && seg.end - last.end > 0) last.end = seg.end;
        return parts;
      });
    }

    case "select":
      return state.segments.some((s) => s.id === action.id) ? { ...state, selectedId: action.id } : state;
  }
}

function mapSegment(
  state: TimelineState,
  id: string,
  fn: (segment: Segment, clip: Clip) => Segment[],
): TimelineState {
  const index = state.segments.findIndex((s) => s.id === id);
  if (index === -1) return state;
  const segment = state.segments[index];
  const replacement = fn(segment, state.clips[segment.clipId]);
  const segments = [...state.segments.slice(0, index), ...replacement, ...state.segments.slice(index + 1)];
  return { ...state, segments };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function toExportItems(state: TimelineState): ExportItem[] {
  return state.segments.map((s) => ({
    clipId: s.clipId,
    info: state.clips[s.clipId].info,
    start: s.start,
    end: s.end,
  }));
}
