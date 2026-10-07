/**
 * Beat-synced edits, built the way viral fan edits (AMVs, phonk edits,
 * "versus" edits) are: music first, every cut on a beat.
 *
 * The structure follows the format that racks up views:
 *   intro  2 bars  two long, calm shots: anticipation, with the hook on screen
 *   build  2 bars  cuts speed up (2 beats, then every beat) under the riser
 *   drop   4 bars  the biggest hit lands exactly on the drop (flash, zoom
 *                  punch, shake), then a cut on every beat, the energy rising
 *   outro  1 bar   slow motion on a big moment (the "aura" ending), with the
 *                  call to action; no end card, so it loops straight back
 * About 15-17 s for hype edits (short edits get watched to the end and
 * replayed, which the algorithms reward most), longer for emotional ones.
 *
 * Shots are cut around measured "hits" (peaks of loudness and motion), so the
 * impact frame lands just after the cut, on the beat. Shots alternate between
 * videos; "versus" alternates strictly between two, which turns the comments
 * into a debate.
 */
import { MUSIC_STYLES, type MusicStyle } from "@/lib/audio/music";
import { BIN_SECONDS, type ClipAnalysis } from "@/lib/video/analysis";
import { cutsPerMinute, findMoments, rawScores, themeSongRanges } from "@/lib/video/highlights";
import type { SegmentFx } from "@/lib/video/types";

export type EditFormat = "hype" | "versus" | "feels" | "trailer" | "quote" | "countdown";

export interface Shot {
  clipId: string;
  /** Source range (seconds). Plays for (end - start) / speed. */
  start: number;
  end: number;
  speed?: number;
  fx?: SegmentFx;
  role: "intro" | "build" | "pause" | "drop" | "outro" | "clip";
  /** Beats it lasts in the edit (fractional for talking clips, which follow the speech). */
  beats: number;
}

export interface EditPlan {
  id: string;
  format: EditFormat;
  title: string;
  emoji: string;
  why: string;
  /** On screen for the first seconds. */
  hook: string;
  /** On screen over the slow-motion ending. */
  cta: string;
  music: MusicStyle;
  bpm: number;
  shots: Shot[];
  /** Output seconds where the beat drops (the biggest hit lands here). */
  dropAt: number;
  /** Output seconds. */
  length: number;
  /** Set when AI Theme Match chose the moments. */
  ai?: boolean;
  /** How the beat sits with the original sound. Edits: the beat leads; talking clips: the voice leads. */
  mix: { volume: number; original: number; duck: boolean };
  /** Word-by-word captions (talking clips). */
  captions: boolean;
  /** Cut on exact frames of the beat grid. */
  exact: boolean;
  /** Big on-screen labels in output time: countdown numbers, or trailer title cards. */
  labels?: { text: string; start: number; end: number; style?: "count" | "card" }[];
  /** Seconds of silence in the music before the drop (the trailer's pause). */
  pause?: number;
}

/** The beat leads, the original sound sits underneath for the impacts. */
export const EDIT_MIX = { volume: 0.9, original: 0.3, duck: false };

export interface EditVideo {
  clipId: string;
  name: string;
  duration: number;
  analysis: ClipAnalysis;
}

interface Hit {
  clipId: string;
  /** Seconds: the impact. */
  t: number;
  strength: number;
}

/** Beats per shot, by section. Hype: long intro shots, cuts speeding up, a cut on every beat after the drop. */
const TEMPLATES: Record<"hype" | "feels" | "trailer", { intro: number[]; build: number[]; pause?: number; drop: number[]; outro: number }> = {
  hype: { intro: [4, 4], build: [2, 2, 1, 1, 1, 1], drop: [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], outro: 4 },
  feels: { intro: [4, 4], build: [4, 2, 2], drop: [4, 4, 4, 4], outro: 4 },
  // A movie trailer: a cold open and three setup shots under title cards, cuts that speed up,
  // one beat of black silence, then the climax on the drop and a final stinger.
  trailer: { intro: [4, 4, 4, 4], build: [2, 2, 1, 1, 1], pause: 1, drop: [4, 1, 1, 1, 1, 1, 1, 1, 1], outro: 4 },
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Peaks of energy (loudness + motion), at least 2 s apart, strongest first; theme songs left out. */
export function findHits(v: Pick<EditVideo, "clipId" | "analysis">, min = 0.55): Hit[] {
  const e = rawScores(v.analysis);
  const n = e.length;
  const blocked = new Uint8Array(n);
  for (const [lo, hi] of themeSongRanges(v.analysis)) blocked.fill(1, Math.max(0, lo - 4), Math.min(n, hi + 4));
  const peaks: Hit[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (blocked[i] || e[i] < min || e[i] < e[i - 1] || e[i] < e[i + 1]) continue;
    peaks.push({ clipId: v.clipId, t: (i + 0.5) * BIN_SECONDS, strength: e[i] });
  }
  peaks.sort((a, b) => b.strength - a.strength);
  const out: Hit[] = [];
  for (const p of peaks) if (out.every((q) => Math.abs(q.t - p.t) >= 2)) out.push(p);
  return out;
}

/** Points every 2.5 s inside a moment (its middle first), so one moment can give several shots. */
function pointsIn(clipId: string, start: number, end: number, strength: number): Hit[] {
  const mid = (start + end) / 2;
  const out: Hit[] = [{ clipId, t: mid, strength }];
  for (let d = 2.5; mid - d > start || mid + d < end; d += 2.5) {
    if (mid + d < end) out.push({ clipId, t: mid + d, strength: strength * 0.95 });
    if (mid - d > start) out.push({ clipId, t: mid - d, strength: strength * 0.95 });
  }
  return out;
}

/** Keeps shots from reusing the same footage. */
class Used {
  private ranges = new Map<string, [number, number][]>();
  free(clipId: string, start: number, end: number) {
    return (this.ranges.get(clipId) ?? []).every(([a, b]) => end + 0.3 <= a || start >= b + 0.3);
  }
  take(clipId: string, start: number, end: number) {
    this.ranges.set(clipId, [...(this.ranges.get(clipId) ?? []), [start, end]]);
  }
}

/** Short names for the on-screen "A vs B": file names without extension, numbering or junk. */
export function shortName(file: string): string {
  const base = file.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  return (base.length > 18 ? `${base.slice(0, 17).trim()}…` : base) || "Video";
}

/**
 * Lays out one edit. `pools` are the hits to cut from, per video, strongest
 * first; `calm` are quiet moments for the intro (and the whole edit for feels).
 */
function layout(
  format: EditFormat,
  music: MusicStyle,
  videos: EditVideo[],
  pools: Map<string, Hit[]>,
  calm: Map<string, Hit[]>,
): { shots: Shot[]; dropAt: number; length: number; bpm: number } | null {
  const bpm = MUSIC_STYLES.find((m) => m.id === music)!.bpm;
  const beat = 60 / bpm;
  const t = TEMPLATES[format === "feels" ? "feels" : format === "trailer" ? "trailer" : "hype"];
  const trailer = format === "trailer";
  const used = new Used();
  // The video with the strongest moment leads (it gets the drop); versus keeps the order it was given.
  const top = (id: string) => (format === "feels" ? calm : pools).get(id)?.[0]?.strength ?? 0;
  const order = videos.map((v) => v.clipId);
  if (format !== "versus") order.sort((a, b) => top(b) - top(a));
  let turn = 0;
  // Whose turn: strictly alternating for versus, round-robin otherwise (skipping videos that ran out).
  const nextVideo = (want: (id: string) => boolean) => {
    for (let k = 0; k < order.length; k++) {
      const id = order[(turn + k) % order.length];
      if (want(id)) {
        turn = (turn + k + 1) % order.length;
        return id;
      }
    }
    return null;
  };

  /** A window of `len` source seconds around a hit: the impact `lead` seconds after the cut. */
  const cut = (pool: Map<string, Hit[]>, len: number, lead: (len: number) => number) => {
    const fits = (h: Hit) => {
      const v = videos.find((x) => x.clipId === h.clipId)!;
      const start = Math.max(0, Math.min(v.duration - len, h.t - lead(len)));
      return used.free(h.clipId, start, start + len) ? { start, end: start + len } : null;
    };
    const id = nextVideo((c) => (pool.get(c) ?? []).some((h) => fits(h)));
    if (!id) return null;
    const h = pool.get(id)!.find((x) => fits(x))!;
    const w = fits(h)!;
    used.take(id, w.start, w.end);
    return { clipId: id, start: r3(w.start), end: r3(w.end), strength: h.strength };
  };

  const shots: Shot[] = [];
  const add = (role: Shot["role"], beats: number, w: { clipId: string; start: number; end: number } | null, extra: Partial<Shot> = {}) => {
    if (!w) return false;
    shots.push({ clipId: w.clipId, start: w.start, end: w.end, role, beats, ...extra });
    return true;
  };

  const feels = format === "feels";
  // Pick the drop's big hit first, so nothing else uses its footage.
  turn = 0;
  const dropLen = t.drop[0] * beat;
  const big = cut(feels ? calm : pools, dropLen, (l) => (feels ? l * 0.35 : 0.08));
  if (!big) return null;
  // The slow-motion ending: another strong moment, half speed.
  const outroSource = (t.outro * beat) / 2;
  const outro = cut(feels ? calm : pools, outroSource, (l) => l * 0.35);

  // Intro: calm shots, the hook on screen. Versus opens on each side once.
  turn = 0;
  for (const [i, beats] of t.intro.entries()) {
    const len = beats * beat;
    const w = cut(calm, len, (l) => l / 2) ?? cut(pools, len, (l) => l * 0.8);
    // Trailer setup shots are dimmed under their title cards and fade in, slow and deliberate.
    const fx = trailer ? (i === 0 ? { dip: 0.5 } : { dip: 0.3, dim: true }) : i === 0 ? { dip: 0.3 } : feels ? { dip: 0.25 } : { flash: 0.08 };
    if (!add("intro", beats, w, { fx })) return null;
  }
  // Build: wind-ups, the impact just after each shot ends (the cut leaves you wanting it).
  for (const [i, beats] of t.build.entries()) {
    const len = beats * beat;
    const w = cut(feels ? calm : pools, len, (l) => l + 0.15) ?? cut(feels ? calm : pools, len, (l) => l / 2);
    // Trailers hit every build cut with a flash; edits only the first.
    if (!add("build", beats, w, feels ? { fx: { dip: 0.2 } } : i === 0 || trailer ? { fx: { flash: 0.1 } } : {})) return null;
  }
  // The pause: one beat of black and silence. The brain braces for the hit that comes next.
  if (t.pause) {
    const w = cut(calm, t.pause * beat, (l) => l / 2) ?? cut(pools, t.pause * beat, (l) => l + 1);
    if (!add("pause", t.pause, w, { fx: { blackout: true } })) return null;
  }
  // Drop: the big hit on the drop, then a cut on every beat with the impact right after the cut.
  add("drop", t.drop[0], big, feels ? { fx: { flash: 0.2 } } : { fx: { flash: 0.15, punch: true, shake: true } });
  const rest: { clipId: string; start: number; end: number; strength: number; beats: number }[] = [];
  for (const beats of t.drop.slice(1)) {
    const len = beats * beat;
    const w = cut(feels ? calm : pools, len, (l) => (feels ? l * 0.4 : Math.min(0.1, l * 0.2)));
    if (w) rest.push({ ...w, beats });
  }
  if (rest.length === 0) return null;
  // Not enough distinct moments for a cut on every beat: hold some for longer, so the drop still fills its bars.
  const needed = t.drop.slice(1).reduce((a, b) => a + b, 0);
  for (let i = 0; rest.reduce((a, x) => a + x.beats, 0) < needed; i = (i + 1) % rest.length) {
    rest[i].beats += 1;
    rest[i].end = r3(rest[i].start + rest[i].beats * beat);
  }
  // Keep the alternation, but let the strongest hits come last, so the drop keeps climbing.
  const strongestLast = [...rest].sort((a, b) => a.strength - b.strength);
  const byVideo = (list: typeof rest) => {
    if (format !== "versus" || videos.length < 2) return list;
    const a = list.filter((s) => s.clipId === order[0]);
    const b = list.filter((s) => s.clipId !== order[0]);
    const out: typeof rest = [];
    // Big hit was from order[0], so the drop continues with the other side.
    while (a.length || b.length) {
      if (b.length) out.push(b.shift()!);
      if (a.length) out.push(a.shift()!);
    }
    return out;
  };
  for (const [i, s] of byVideo(strongestLast).entries()) {
    const downbeat = (t.drop[0] + i + 1) % 4 === 0;
    const backbeat = (t.drop[0] + i + 1) % 4 === 2;
    add("drop", s.beats, s, feels ? { fx: { dip: 0.15 } } : { fx: downbeat ? { flash: 0.1, punch: true } : backbeat ? { shake: true } : undefined });
  }
  if (outro) add("outro", t.outro, outro, { speed: 0.5, fx: feels ? { dip: 0.3 } : { flash: 0.2 } });
  else return null;

  const dropAt = r3(([...t.intro, ...t.build].reduce((s, b) => s + b, 0) + (t.pause ?? 0)) * beat);
  const length = r3(shots.reduce((s, x) => s + x.beats, 0) * beat);
  return { shots, dropAt, length, bpm };
}

/** Trailer title cards: three words that build a sentence over the setup shots, the way trailers open a question. */
const CARD_LINES = [
  ["ONE MOMENT", "CHANGED", "EVERYTHING"],
  ["NO ONE", "SAW IT", "COMING"],
  ["THIS IS", "WHERE IT", "BEGINS"],
  ["EVERY LEGEND", "HAS A", "BEGINNING"],
];

function trailerCards(shots: Shot[], bpm: number, videos: EditVideo[]): NonNullable<EditPlan["labels"]> {
  const beat = 60 / bpm;
  const lines = CARD_LINES[Math.round(videos.reduce((s, v) => s + v.duration, 0)) % CARD_LINES.length];
  const cards: NonNullable<EditPlan["labels"]> = [];
  let t = 0;
  let n = 0;
  for (const s of shots) {
    const len = s.beats * beat;
    // The setup shots after the cold open carry the cards, from a moment after the cut to just before the next.
    if (s.role === "intro" && s.fx?.dim && n < lines.length) cards.push({ text: lines[n++], start: r3(t + 0.25), end: r3(t + len - 0.15), style: "card" });
    t += len;
  }
  return cards;
}

/**
 * The beat that suits the footage: heavily edited, fast footage (anime,
 * fight scenes, film action) gets phonk; footage with fewer cuts (sports,
 * gaming, vlogs) gets hype trap.
 */
export function beatFor(videos: EditVideo[]): MusicStyle {
  const pace = videos.reduce((s, v) => s + cutsPerMinute(v.analysis), 0) / Math.max(1, videos.length);
  return pace >= 12 ? "phonk" : "trap";
}

/**
 * Edit suggestions for these videos: a hype edit, a versus edit (two or more
 * videos) and an emotional edit, each where there's enough footage for it.
 */
export function planEdits(videos: EditVideo[], styles: Partial<Record<EditFormat, MusicStyle>> = {}): EditPlan[] {
  const pools = new Map(videos.map((v) => [v.clipId, findHits(v)]));
  // Quiet, meaningful moments from the calm moment finder, a point every couple of seconds inside each.
  const calm = new Map(
    videos.map((v) => [
      v.clipId,
      v.analysis.hasAudio
        ? findMoments(v.clipId, v.duration, v.analysis, { minSeconds: 4, maxSeconds: 8, maxMoments: 10, calm: true }).flatMap((m) =>
            pointsIn(v.clipId, m.start, m.end, Math.min(1, m.score)),
          )
        : [],
    ]),
  );
  const names = videos.map((v) => shortName(v.name));
  const plans: EditPlan[] = [];

  const music = {
    hype: styles.hype ?? beatFor(videos),
    versus: styles.versus ?? "trap",
    feels: styles.feels ?? "cinematic",
    trailer: styles.trailer ?? "cinematic",
  } as const;

  const trailer = layout("trailer", music.trailer, videos, pools, calm);
  if (trailer) {
    plans.push({
      id: "trailer",
      format: "trailer",
      title: "Trailer",
      emoji: "🎬",
      why: "Built like a movie trailer: a cold open, three setup shots under title cards that open a question, cuts that speed up, one beat of black silence, then the climax on the drop and a final stinger.",
      hook: "",
      cta: "Watch it all on my page",
      music: music.trailer,
      // The voices of the setup carry through; the score swells around them.
      mix: { volume: 0.85, original: 0.6, duck: true },
      captions: false,
      exact: true,
      labels: trailerCards(trailer.shots, trailer.bpm, videos),
      pause: (60 / trailer.bpm) * (TEMPLATES.trailer.pause ?? 1),
      ...trailer,
    });
  }
  const hype = layout("hype", music.hype, videos, pools, calm);
  if (hype) {
    plans.push({
      id: "hype",
      format: "hype",
      title: "Hype edit",
      emoji: "⚡",
      why: `${hype.shots.length} cuts on the beat: slow intro, cuts speeding up, the biggest hit on the drop, a cut on every beat, then a slow-motion ending that loops.`,
      hook: "Wait for the drop",
      cta: "Rate this edit 1-10",
      music: music.hype,
      mix: EDIT_MIX,
      captions: false,
      exact: true,
      ...hype,
    });
  }
  if (videos.length >= 2) {
    const two = videos.slice(0, 2);
    const vs = layout("versus", music.versus, two, pools, calm);
    if (vs) {
      plans.push({
        id: "versus",
        format: "versus",
        title: `${names[0]} vs ${names[1]}`,
        emoji: "🥊",
        why: "Cuts back and forth between the two on every beat. Versus edits make people pick a side in the comments, and comments push a video further.",
        hook: `${names[0]} vs ${names[1]}`,
        cta: "Who wins? Comment below",
        music: music.versus,
        mix: EDIT_MIX,
        captions: false,
        exact: true,
        ...vs,
      });
    }
  }
  const feels = layout("feels", music.feels, videos, pools, calm);
  if (feels) {
    plans.push({
      id: "feels",
      format: "feels",
      title: "Emotional edit",
      emoji: "💧",
      why: "Quiet, heavy moments cut on the bar with soft dips, a swelling score, and a slow-motion ending. Sad edits get saved and sent to friends.",
      hook: "This one hits different",
      cta: "Send this to someone who gets it",
      music: music.feels,
      mix: EDIT_MIX,
      captions: false,
      exact: true,
      ...feels,
    });
  }
  return plans;
}

/**
 * An edit from moments AI Theme Match grouped: the same structure, cut only
 * from those moments (in their order of strength), with its music.
 */
export function planThemedEdit(
  videos: EditVideo[],
  moments: { clipId: string; start: number; end: number }[],
  meta: { id: string; title: string; why: string; hook: string; music: MusicStyle },
): EditPlan | null {
  const inside = (h: Hit) => moments.some((m) => m.clipId === h.clipId && h.t >= m.start && h.t <= m.end);
  const ids = [...new Set(moments.map((m) => m.clipId))];
  const vids = ids.flatMap((id) => videos.filter((v) => v.clipId === id));
  const pools = new Map(vids.map((v) => [v.clipId, findHits(v, 0.3).filter(inside)]));
  const calm = new Map(vids.map((v) => [v.clipId, moments.filter((m) => m.clipId === v.clipId).flatMap((m) => pointsIn(v.clipId, m.start, m.end, 0.5))]));
  const format: EditFormat = meta.music === "cinematic" || meta.music === "lofi" ? "feels" : "hype";
  const plan = layout(format, meta.music, vids, pools, calm);
  if (!plan) return null;
  return {
    ...meta,
    format,
    emoji: "🧠",
    cta: format === "feels" ? "Send this to someone who gets it" : "Rate this edit 1-10",
    ai: true,
    mix: EDIT_MIX,
    captions: false,
    exact: true,
    ...plan,
  };
}
