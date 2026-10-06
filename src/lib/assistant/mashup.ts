/**
 * Moments with a feel, across videos: fights and action (loud, fast,
 * intense), build-ups and reveals (the payoff of a climb), and quiet
 * emotional scenes (slow and still, with a voice or score playing). AI Theme
 * Match looks at these to group moments from different videos by story; the
 * edits themselves are laid out in beat-edit.ts.
 */
import { BIN_SECONDS, type ClipAnalysis } from "@/lib/video/analysis";
import { findMoments, type Moment, rawScores } from "@/lib/video/highlights";

export type Mood = "action" | "rising" | "feels";

export interface Beat {
  /** Stable id: "<clipId>@<start>". */
  id: string;
  clipId: string;
  start: number;
  end: number;
  peak: number;
  mood: Mood;
  /** How strongly it has that feel, 0..1. */
  fit: number;
}

export const MOODS: Record<Mood, { feel: string }> = {
  action: { feel: "fast, loud, intense" },
  rising: { feel: "energy that climbs to a peak" },
  feels: { feel: "slow and quiet, with feeling" },
};

export interface MashupVideo {
  clipId: string;
  duration: number;
  analysis: ClipAnalysis;
}

const beatId = (m: { clipId: string; start: number }) => `${m.clipId}@${m.start.toFixed(2)}`;

/** The feel of an energetic moment, and how strongly it has it. */
export function moodOf(m: Pick<Moment, "signals">, lead = 0): { mood: Mood; fit: number } {
  const s = m.signals;
  const action = 0.4 * s.intensity + 0.3 * s.pacing + 0.3 * s.peak;
  // Rising: the energy climbs inside the beat, or the beat is the payoff of a climb before it.
  const climb = Math.max((s.build - 0.5) * 2.5, lead * 1.6);
  const rising = 0.55 * Math.min(1, Math.max(0, climb)) + 0.45 * s.peak;
  // A clear climb makes it a reveal, even when the payoff is as loud as a fight.
  if (climb >= 0.6) return { mood: "rising", fit: Math.max(rising, action) };
  return rising > action ? { mood: "rising", fit: rising } : { mood: "action", fit: action };
}

/** Candidate beats from every video, each tagged with its feel. */
export function findBeats(videos: MashupVideo[]): Beat[] {
  const beats: Beat[] = [];
  for (const v of videos) {
    const energy = rawScores(v.analysis);
    const avg = (from: number, to: number) => {
      const lo = Math.max(0, Math.floor(from / BIN_SECONDS));
      const hi = Math.min(energy.length, Math.ceil(to / BIN_SECONDS));
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += energy[i];
      return hi > lo ? sum / (hi - lo) : 0;
    };
    for (const m of findMoments(v.clipId, v.duration, v.analysis, { minSeconds: 3, maxSeconds: 7, maxMoments: 12 })) {
      // How much more is happening than in the 10 seconds before: the payoff of a build-up.
      const lead = m.start >= 10 ? avg(m.start, m.end) - avg(m.start - 10, m.start) : 0;
      beats.push({ id: beatId(m), clipId: m.clipId, start: m.start, end: m.end, peak: m.peak, ...moodOf(m, lead) });
    }
    if (!v.analysis.hasAudio) continue;
    for (const m of findMoments(v.clipId, v.duration, v.analysis, { minSeconds: 4, maxSeconds: 8, maxMoments: 5, calm: true })) {
      // Don't let a calm pick overlap an energetic one from the same video.
      if (beats.some((b) => b.clipId === m.clipId && m.start < b.end && b.start < m.end)) continue;
      beats.push({ id: beatId(m), clipId: m.clipId, start: m.start, end: m.end, peak: m.peak, mood: "feels", fit: Math.min(1, m.score) });
    }
  }
  return beats;
}
