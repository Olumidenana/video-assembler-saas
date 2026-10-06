/**
 * Edits for talking content (podcasts, interviews, streams, sermons,
 * commentary): the formats clippers use to turn long videos into shorts that
 * travel.
 *
 * - Quote edit: the strongest self-contained line, kept whole (the voice
 *   carries it), with a punch-in zoom on every bar so the frame never sits
 *   still (each change is a small pattern interrupt that resets attention),
 *   word-by-word captions for people watching on mute, and a score that
 *   swells under it and drops after the opening line.
 * - Top 3 countdown: the three best moments, weakest first, numbered #3, #2,
 *   #1. The countdown is an open loop: people stay to see #1.
 */
import { MUSIC_STYLES, type MusicStyle } from "@/lib/audio/music";
import type { ClipAnalysis } from "@/lib/video/analysis";
import type { Word } from "@/lib/video/captions";
import { type EditPlan, type Shot, shortName } from "./beat-edit";
import { findClipsByScene, findViralClips, type ViralClip } from "./viral";

export interface TalkVideo {
  clipId: string;
  name: string;
  duration: number;
  analysis: ClipAnalysis;
  /** Empty when there's no usable speech; then moments are judged on sound and picture. */
  words: Word[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The voice leads; the beat sits under it and dips while people talk. */
const TALK_MIX = { volume: 0.4, original: 1, duck: true };

/** Quotes: whole sentences, long enough to land, short enough to replay. */
export function findQuotes(videos: TalkVideo[], count = 2): ViralClip[] {
  return videos
    .filter((v) => v.words.length > 20)
    .flatMap((v) => findViralClips(v.clipId, v.words, v.analysis, { minSeconds: 12, maxSeconds: 28, maxClips: 4 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

/**
 * Lays a quote out on the beat: one continuous stretch of speech, split on
 * every bar into alternating wide and punched-in shots. Cut points are on
 * whole frames (`fps`), so the sound runs on without a gap or a repeat.
 */
export function planQuote(quote: ViralClip, music: MusicStyle, fps: number, index = 0): EditPlan {
  const bpm = MUSIC_STYLES.find((m) => m.id === music)!.bpm;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const length = quote.end - quote.start;
  const frame = (t: number) => Math.round(t * fps) / fps;
  const cuts: number[] = [0];
  for (let t = bar; t < length - beat * 2; t += bar) cuts.push(frame(t));
  cuts.push(frame(length));
  const shots: Shot[] = cuts.slice(0, -1).map((at, i) => ({
    clipId: quote.clipId,
    start: r3(quote.start + at),
    end: r3(quote.start + cuts[i + 1]),
    role: "clip",
    beats: (cuts[i + 1] - at) / beat,
    // Wide, close, wide, close: the punch-in lands on the downbeat.
    fx: i % 2 === 1 ? { zoom: 1.22 } : undefined,
  }));
  // The drop comes after the opening line (two bars in), when there's room for it.
  const dropAt = length > bar * 3 ? r3(cuts[Math.min(2, cuts.length - 2)]) : 0;
  return {
    id: `quote-${index}`,
    format: "quote",
    title: index === 0 ? "Quote edit" : "Quote edit #2",
    emoji: "🎙️",
    why: `The strongest line, kept whole (${Math.round(length)}s), with a punch-in zoom on every bar so the frame keeps moving, word-by-word captions for people watching on mute, and a score that swells underneath.`,
    hook: "Listen to this till the end",
    cta: "Send this to someone who needs it",
    music,
    bpm,
    shots,
    dropAt,
    length: r3(length),
    mix: TALK_MIX,
    captions: true,
    exact: true,
  };
}

/** The best few moments across the videos, as whole sentences (or scenes without speech), not overlapping. */
export function findCountdownMoments(videos: TalkVideo[], count = 3): ViralClip[] {
  const all = videos.flatMap((v) =>
    v.words.length > 20
      ? findViralClips(v.clipId, v.words, v.analysis, { minSeconds: 7, maxSeconds: 15, maxClips: 6 })
      : findClipsByScene(v.clipId, v.duration, v.analysis, { minSeconds: 6, maxSeconds: 12, maxClips: 6 }),
  );
  const picked: ViralClip[] = [];
  for (const c of all.sort((a, b) => b.score - a.score)) {
    if (picked.length >= count) break;
    if (picked.some((p) => p.clipId === c.clipId && c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
  }
  return picked;
}

/** Top N countdown: weakest first, each numbered, a flash between them, the best saved for last. */
export function planCountdown(videos: TalkVideo[], music: MusicStyle = "lofi", count = 3): EditPlan | null {
  const moments = findCountdownMoments(videos, count);
  if (moments.length < 2) return null;
  const ordered = [...moments].reverse();
  const bpm = MUSIC_STYLES.find((m) => m.id === music)!.bpm;
  const beat = 60 / bpm;
  let t = 0;
  const labels: NonNullable<EditPlan["labels"]> = [];
  const shots: Shot[] = ordered.map((m, i) => {
    const len = m.end - m.start;
    labels.push({ text: `#${ordered.length - i}`, start: r3(t), end: r3(t + len) });
    t += len;
    return { clipId: m.clipId, start: r3(m.start), end: r3(m.end), role: "clip", beats: len / beat, fx: i === 0 ? { dip: 0.25 } : { flash: 0.15 } };
  });
  const from = videos.length === 1 ? ` from ${shortName(videos[0].name)}` : "";
  return {
    id: "countdown",
    format: "countdown",
    title: `Top ${ordered.length} moments${from}`,
    emoji: "🏆",
    why: `The ${ordered.length} strongest moments, weakest first and numbered down to #1. A countdown is an open loop: people stay to see #1, which is what the algorithm rewards.`,
    hook: `Top ${ordered.length} moments. Wait for #1`,
    cta: "Which one was best? Comment below",
    music,
    bpm,
    shots,
    dropAt: 0,
    length: r3(t),
    mix: { volume: 0.25, original: 1, duck: true },
    captions: true,
    exact: false,
    labels,
  };
}

/** Talking-content edits for these videos: up to two quote edits and a countdown. */
export function planTalkEdits(videos: TalkVideo[], fps: number, styles: { quote?: MusicStyle; countdown?: MusicStyle } = {}): EditPlan[] {
  const quotes = findQuotes(videos).map((q, i) => planQuote(q, styles.quote ?? "cinematic", fps, i));
  const countdown = planCountdown(videos, styles.countdown ?? "lofi");
  return [...quotes, ...(countdown ? [countdown] : [])];
}
