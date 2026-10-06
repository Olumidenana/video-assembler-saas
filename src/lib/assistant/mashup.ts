/**
 * Mashups: short edits that cut between several videos (episodes, films,
 * games) on moments that belong together. Moments are matched on their feel,
 * measured from the footage: fights and action (loud, fast, intense),
 * build-ups and reveals (energy climbing to a peak), and quiet emotional
 * scenes (slow and still, with a voice or score playing). Matching on story
 * themes (rivalry, sacrifice, betrayal) needs eyes on the footage: that's AI
 * Theme Match (Studio), which regroups these same moments.
 *
 * Each mashup is ordered as an arc: open on a strong beat, build, land the
 * biggest moment last, with consecutive beats from different videos where
 * possible (the cross-cut is the point of a mashup).
 */
import type { MusicStyle } from "@/lib/audio/music";
import { BIN_SECONDS, type ClipAnalysis } from "@/lib/video/analysis";
import { findMoments, type Moment, rawScores } from "@/lib/video/highlights";
import { TRANSITIONS, type TransitionType } from "@/lib/video/transitions";

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

export interface Mashup {
  id: string;
  title: string;
  emoji: string;
  why: string;
  /** Hook line for the opening seconds. */
  hook: string;
  beats: Beat[];
  music: MusicStyle;
  transition: TransitionType;
  /** Seconds, before transitions overlap the beats. */
  length: number;
  /** Set when AI Theme Match grouped these. */
  ai?: boolean;
}

export const MOODS: Record<Mood, { title: string; emoji: string; music: MusicStyle; transition: TransitionType; beats: number; hook: string; feel: string }> = {
  action: { title: "Fights & action", emoji: "⚔️", music: "phonk", transition: "fadewhite", beats: 6, hook: "Who hits harder?", feel: "fast, loud, intense" },
  rising: { title: "Build-ups & reveals", emoji: "🔥", music: "cinematic", transition: "zoomin", beats: 5, hook: "Wait for the last one", feel: "energy that climbs to a peak" },
  feels: { title: "Emotional moments", emoji: "💧", music: "lofi", transition: "fade", beats: 5, hook: "This one hurts", feel: "slow and quiet, with feeling" },
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

/**
 * Orders beats as an arc: the second strongest opens (the hook), the rest
 * build in strength, the strongest lands last. Then nudges the order so two
 * beats from the same video don't play back to back, without moving the ends.
 */
export function arrange(beats: Beat[]): Beat[] {
  if (beats.length <= 2) return [...beats].sort((a, b) => a.fit - b.fit);
  const byFit = [...beats].sort((a, b) => a.fit - b.fit);
  const best = byFit.pop()!;
  const opener = byFit.pop()!;
  const order = [opener, ...byFit, best];
  for (let i = 1; i < order.length - 1; i++) {
    if (order[i].clipId !== order[i - 1].clipId) continue;
    const j = order.findIndex((b, k) => k > i && k < order.length - 1 && b.clipId !== order[i - 1].clipId);
    if (j > 0) [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Takes beats round-robin from each video (each video's best first) until the
 * mashup has `count` beats or reaches `maxSeconds`.
 */
function pickAcross(pool: Beat[], count: number, maxSeconds: number): Beat[] {
  const perVideo = new Map<string, Beat[]>();
  for (const b of [...pool].sort((a, b) => b.fit - a.fit)) perVideo.set(b.clipId, [...(perVideo.get(b.clipId) ?? []), b]);
  const queues = [...perVideo.values()].sort((a, b) => b[0].fit - a[0].fit);
  const out: Beat[] = [];
  let total = 0;
  for (let round = 0; out.length < count; round++) {
    let added = false;
    for (const q of queues) {
      const b = q[round];
      if (!b || out.length >= count || total + (b.end - b.start) > maxSeconds) continue;
      out.push(b);
      total += b.end - b.start;
      added = true;
    }
    if (!added) break;
  }
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const transitionLabel = (t: TransitionType) => TRANSITIONS.find((x) => x.id === t)?.label.toLowerCase() ?? t;

/**
 * Mashup suggestions across the videos: one per feel that at least two videos
 * share, plus a "best of" that mixes the strongest moments of every kind.
 */
export function suggestMashups(videos: MashupVideo[], opts: { maxSeconds?: number } = {}): Mashup[] {
  const maxSeconds = opts.maxSeconds ?? 40;
  const beats = findBeats(videos);
  const out: Mashup[] = [];
  for (const mood of ["action", "rising", "feels"] as Mood[]) {
    const pool = beats.filter((b) => b.mood === mood && b.fit >= 0.35);
    const sources = new Set(pool.map((b) => b.clipId));
    if (sources.size < 2) continue;
    const m = MOODS[mood];
    const picked = arrange(pickAcross(pool, m.beats, maxSeconds));
    if (picked.length < 3) continue;
    const from = new Set(picked.map((b) => b.clipId)).size;
    out.push({
      id: mood,
      title: m.title,
      emoji: m.emoji,
      hook: m.hook,
      why: `${plural(picked.length, "moment")} from ${plural(from, "video")} that share the same feel (${m.feel}), joined with ${transitionLabel(m.transition)} transitions, the biggest one last for the drop.`,
      beats: picked,
      music: m.music,
      transition: m.transition,
      length: picked.reduce((s, b) => s + b.end - b.start, 0),
    });
  }
  const energetic = beats.filter((b) => b.mood !== "feels");
  if (new Set(energetic.map((b) => b.clipId)).size >= 2) {
    const picked = arrange(pickAcross(energetic, 6, maxSeconds));
    const ids = new Set(picked.map((b) => b.id));
    // When the videos are all one feel, "best of" is the same edit as that feel's: don't offer it twice.
    const duplicate = out.some((m) => m.beats.filter((b) => ids.has(b.id)).length >= picked.length * (2 / 3));
    if (picked.length >= 3 && !duplicate) {
      out.unshift({
        id: "best",
        title: "Best of everything",
        emoji: "⚡",
        hook: "Which one is the hardest?",
        why: `The strongest ${plural(picked.length, "moment")} across ${plural(new Set(picked.map((b) => b.clipId)).size, "video")}, building to the biggest, with flash cuts and a phonk drop.`,
        beats: picked,
        music: "phonk",
        transition: "fadewhite",
        length: picked.reduce((s, b) => s + b.end - b.start, 0),
      });
    }
  }
  return out;
}

/** The transition into a beat: the one chosen, or for "auto" the mashup's own (the beat's feel for mixed ones). */
export function transitionFor(mashup: Pick<Mashup, "id" | "transition">, beat: Beat, choice: TransitionType | "auto" = "auto"): TransitionType {
  if (choice !== "auto") return choice;
  return mashup.id === "best" ? MOODS[beat.mood].transition : mashup.transition;
}
