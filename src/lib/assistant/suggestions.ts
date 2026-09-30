import type { ClipAnalysis } from "@/lib/video/analysis";
import { removeSilences } from "@/lib/video/highlights";
import type { EditorAction } from "./actions";

export interface Suggestion {
  id: string;
  label: string;
  detail: string;
  actions: EditorAction[];
  /** Export mode to switch to after applying (e.g. "parts" after splitting for Status). */
  mode?: "stitch" | "parts";
}

export interface SuggestionInput {
  clips: { id: string; duration: number; width: number; height: number }[];
  segments: { clipId: string; start: number; end: number }[];
  analyses: Record<string, ClipAnalysis>;
}

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`);

/**
 * Edits worth offering for this footage, most useful first (max 3):
 * silence to remove, a highlight reel sized for social, and splitting for
 * WhatsApp Status when it's long.
 */
export function buildSuggestions({ clips, segments, analyses }: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  const total = segments.reduce((sum, s) => sum + s.end - s.start, 0);
  if (total === 0) return out;

  // Silence: how much would "remove silences" cut from what's on the timeline?
  let silent = 0;
  let measured = 0;
  for (const seg of segments) {
    const a = analyses[seg.clipId];
    if (!a?.hasAudio) continue;
    const from = Math.floor(seg.start / 0.5);
    const to = Math.ceil(seg.end / 0.5);
    const slice = { ...a, loudness: a.loudness.slice(from, to), motion: a.motion.slice(from, to), cuts: a.cuts.slice(from, to) };
    const duration = seg.end - seg.start;
    const kept = removeSilences([{ clipId: "x", duration, analysis: slice }]).reduce((sum, r) => sum + r.end - r.start, 0);
    silent += Math.max(0, duration - kept);
    measured += duration;
  }
  if (silent >= 3 && measured > 0 && silent / measured >= 0.08) {
    out.push({
      id: "silence",
      label: `Remove ${fmt(silent)} of silence`,
      detail: "Cuts pauses and dead air so it flows faster.",
      actions: [{ type: "remove_silence" }],
    });
  }

  const inUse = clips.filter((c) => segments.some((s) => s.clipId === c.id));
  const portrait = inUse.filter((c) => c.height > c.width).length >= inUse.length / 2;
  const allAnalysed = inUse.every((c) => analyses[c.id]);

  if (total > 40 && allAnalysed) {
    const target = total > 150 ? 60 : 30;
    out.push({
      id: "highlight",
      label: `Make a ${target}s highlight${portrait ? " for Reels & Status" : ""}`,
      detail: "Keeps the loudest, most active moments.",
      actions: [{ type: "highlights", seconds: target }],
    });
  }

  // Splitting works per segment, so only offer it when a segment is actually long.
  const lengths = segments.map((seg) => seg.end - seg.start);
  if (lengths.some((len) => len > 65)) {
    const parts = lengths.reduce((sum, len) => sum + Math.ceil(len / 60 - 0.01), 0);
    out.push({
      id: "split",
      label: `Split into ${parts} parts of 60s for WhatsApp Status`,
      detail: "Each part saved as its own file, ready to post.",
      actions: [{ type: "split_every", seconds: 60, segment: null }],
      mode: "parts",
    });
  }

  return out.slice(0, 3);
}
