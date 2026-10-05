/**
 * Viral Clip Finder: scores candidate clips with content-psychology signals
 * (hook, curiosity gap, emotion, value/payoff, pacing) using the transcript
 * and the audio/motion analysis. Pure, local and free; Claude can refine the
 * picks and write the post kit (see /api/viral).
 */
import type { ClipAnalysis } from "@/lib/video/analysis";
import type { Word } from "@/lib/video/captions";
import { findMoments } from "@/lib/video/highlights";

export interface ViralScores {
  hook: number;
  curiosity: number;
  emotion: number;
  value: number;
  pacing: number;
}

export interface ViralClip {
  id: string;
  clipId: string;
  start: number;
  end: number;
  /** The strongest moment, for the preview still (seconds in the source). */
  peak?: number;
  /** 0–100 */
  score: number;
  scores: ViralScores;
  /** The opening line viewers hear first. */
  hook: string;
  /** Short reasons, e.g. "Opens with a question". */
  reasons: string[];
  title: string;
  caption: string;
  hashtags: string[];
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  words: Word[];
}

const WEIGHTS: ViralScores = { hook: 0.32, curiosity: 0.2, emotion: 0.2, value: 0.14, pacing: 0.14 };

const HOOK_OPENERS = /^(stop|listen|wait|look|imagine|nobody|no one|never|here'?s|this is|the (reason|truth|secret|problem)|why|how|what if|did you know|if you|you (need|have|won'?t|will|can'?t)|i (can'?t believe|quit|lost|made|tried)|don'?t)/i;
const POWER_WORDS = /\b(secret|mistake|truth|nobody|never|stop|warning|crazy|insane|shocking|million|money|free|hack|trick|exposed|real reason|biggest|worst|best|only|instantly|guaranteed)\b/i;
const CURIOSITY = /\b(here'?s why|the secret|what happened|turns out|until|but then|wait for it|the reason|guess what|you won'?t believe|plot twist|nobody (knows|tells)|the truth|but here'?s|watch (this|till))\b/i;
const EMOTION_WORDS = /\b(love|hate|cry|cried|laugh|scared|afraid|angry|shocked|amazing|incredible|beautiful|god|wow|omg|crazy|insane|heartbroken|proud|blessed|unbelievable|painful|happy)\b/i;
const VALUE_WORDS = /\b(tip|step|first|second|third|lesson|learn|how to|the key|rule|strategy|framework|secret is|you should|do this|instead|mistake|advice|that'?s why|so that)\b/i;
const STOPWORDS = new Set(
  "the a an and or but so if then than that this these those to of in on at for with from by as is are was were be been being it its i you he she we they me him her us them my your our their what which who whom when where why how not no yes do does did have has had will will would can could should just really very also about into out up down over again more most some any all each other such only own same too here there now nobody tells tell told said says going thing things people completely simple changed before anyone else like dont don't know think want make made good well even life yeah okay fine came went".split(
    " ",
  ),
);

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Sentences from word timings: ends at . ! ? or a pause longer than 0.8 s. */
export function toSentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    out.push({
      text: current.map((w) => w.text.trim()).join(" ").replace(/\s+/g, " ").trim(),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };
  words.forEach((w, i) => {
    const next = words[i + 1];
    current.push(w);
    if (/[.!?]["')]?$/.test(w.text.trim()) || (next && next.start - w.end > 0.8)) flush();
  });
  flush();
  return out;
}

function windowAnalysis(a: ClipAnalysis | undefined, start: number, end: number) {
  if (!a) return { loud: 0.5, loudVar: 0, motion: 0.5, silentShare: 0 };
  const from = Math.max(0, Math.floor(start / 0.5));
  const to = Math.max(from + 1, Math.ceil(end / 0.5));
  const db = a.loudness.slice(from, to);
  const all = a.loudness.filter((v) => v > -90);
  const floor = all.length ? [...all].sort((x, y) => x - y)[Math.floor(all.length * 0.1)] : -60;
  const norm = db.map((v) => Math.max(0, Math.min(1, (v - floor) / 35)));
  const mean = norm.reduce((s, v) => s + v, 0) / Math.max(1, norm.length);
  const variance = norm.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, norm.length);
  const motion = a.motion.slice(from, to);
  const mMax = Math.max(1e-6, ...a.motion);
  return {
    loud: mean,
    loudVar: Math.sqrt(variance),
    motion: motion.reduce((s, v) => s + v / mMax, 0) / Math.max(1, motion.length),
    silentShare: a.hasAudio ? norm.filter((v) => v < 0.15).length / Math.max(1, norm.length) : 0,
  };
}

/** Scores one candidate (a run of sentences) and explains why. */
export function scoreCandidate(sentences: Sentence[], analysis: ClipAnalysis | undefined): { scores: ViralScores; reasons: string[] } {
  const first = sentences[0]?.text ?? "";
  const all = sentences.map((s) => s.text).join(" ");
  const start = sentences[0]?.start ?? 0;
  const end = sentences[sentences.length - 1]?.end ?? start;
  const duration = Math.max(0.1, end - start);
  const words = sentences.reduce((n, s) => n + s.words.length, 0);
  const firstWords = first.split(/\s+/).length;
  const w = windowAnalysis(analysis, start, end);
  const reasons: string[] = [];

  let hook = 25;
  if (HOOK_OPENERS.test(first)) {
    hook += 30;
    reasons.push("Strong opening line");
  }
  if (/\?/.test(first)) {
    hook += 20;
    reasons.push("Opens with a question");
  }
  if (/\b(you|your)\b/i.test(first)) hook += 10;
  if (/\d/.test(first)) {
    hook += 10;
    reasons.push("Specific number up front");
  }
  if (POWER_WORDS.test(first)) hook += 15;
  if (firstWords <= 12) hook += 10;
  else if (firstWords > 25) hook -= 15;

  let curiosity = 20;
  const loops = (all.match(new RegExp(CURIOSITY.source, "gi")) ?? []).length;
  if (loops) {
    curiosity += 25 + 10 * Math.min(3, loops);
    reasons.push("Opens a curiosity loop");
  }
  if (/\?/.test(all)) curiosity += 10;
  if (/\b(but|however|until|then)\b/i.test(all)) curiosity += 10;

  let emotion = 20 + 40 * w.loud + 60 * w.loudVar;
  const feels = (all.match(new RegExp(EMOTION_WORDS.source, "gi")) ?? []).length;
  if (feels) emotion += 10 * Math.min(3, feels);
  if (/!/.test(all)) emotion += 10;
  if (w.loudVar > 0.2 || feels >= 2) reasons.push("Emotional peaks");

  let value = 25;
  const tips = (all.match(new RegExp(VALUE_WORDS.source, "gi")) ?? []).length;
  if (tips) {
    value += 15 * Math.min(3, tips);
    reasons.push("Gives real value");
  }
  if (/[.!?]$/.test(sentences[sentences.length - 1]?.text ?? "")) {
    value += 15;
    reasons.push("Ends on a complete thought");
  }

  const rate = words / duration;
  let pacing = 60 - Math.abs(rate - 2.8) * 25 + 25 * w.motion - 60 * w.silentShare;
  if (rate >= 2.2 && rate <= 3.6 && w.silentShare < 0.15) reasons.push("Tight pacing");
  pacing = Math.max(0, pacing);

  return {
    scores: { hook: clamp(hook), curiosity: clamp(curiosity), emotion: clamp(emotion), value: clamp(value), pacing: clamp(pacing) },
    reasons: [...new Set(reasons)].slice(0, 3),
  };
}

export const overallScore = (s: ViralScores) =>
  clamp(s.hook * WEIGHTS.hook + s.curiosity * WEIGHTS.curiosity + s.emotion * WEIGHTS.emotion + s.value * WEIGHTS.value + s.pacing * WEIGHTS.pacing);

/** Simple post kit from the clip's own words (Claude writes better ones when available). */
export function localPostKit(sentences: Sentence[]): { title: string; caption: string; hashtags: string[] } {
  const first = sentences[0]?.text ?? "";
  const title = first.length > 70 ? `${first.slice(0, 67).replace(/\s+\S*$/, "")}…` : first;
  const caption = sentences
    .slice(0, 2)
    .map((s) => s.text)
    .join(" ")
    .slice(0, 220);
  // Topic words: the hook counts double, since it states what the clip is about.
  const counts = new Map<string, number>();
  sentences.forEach((s, i) => {
    for (const raw of s.text.toLowerCase().match(/[a-z][a-z']{3,}/g) ?? []) {
      if (!STOPWORDS.has(raw)) counts.set(raw, (counts.get(raw) ?? 0) + (i === 0 ? 2 : 1));
    }
  });
  const topics = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => `#${w.replace(/'/g, "")}`);
  return { title, caption, hashtags: [...topics, "#reels", "#shorts"] };
}

export interface FindOptions {
  /** Desired clip length range in seconds. */
  minSeconds?: number;
  maxSeconds?: number;
  maxClips?: number;
}

/**
 * Candidate clips start at a sentence and run to a sentence end within the
 * length range; the best-scoring non-overlapping ones win.
 */
export function findViralClips(
  clipId: string,
  words: Word[],
  analysis: ClipAnalysis | undefined,
  { minSeconds = 15, maxSeconds = 60, maxClips = 10 }: FindOptions = {},
): ViralClip[] {
  const sentences = toSentences(words);
  const candidates: ViralClip[] = [];
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i; j < sentences.length; j++) {
      const length = sentences[j].end - sentences[i].start;
      if (length > maxSeconds) break;
      if (length < minSeconds) continue;
      const run = sentences.slice(i, j + 1);
      const { scores, reasons } = scoreCandidate(run, analysis);
      candidates.push({
        id: `${clipId}:${i}-${j}`,
        clipId,
        start: Math.max(0, run[0].start - 0.15),
        end: run[run.length - 1].end + 0.3,
        score: overallScore(scores),
        scores,
        hook: run[0].text,
        reasons,
        ...localPostKit(run),
      });
    }
  }
  const picked: ViralClip[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (picked.length >= maxClips) break;
    if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
  }
  return picked;
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Viral clips from scenes rather than speech: for anime, films, gaming,
 * sports and skits, or any video without usable speech. See findMoments.
 */
export function findClipsByScene(clipId: string, duration: number, analysis: ClipAnalysis, opts: FindOptions = {}): ViralClip[] {
  const { minSeconds = 15, maxSeconds = 60, maxClips = 10 } = opts;
  const moments = findMoments(clipId, duration, analysis, {
    minSeconds: Math.min(minSeconds, duration),
    maxSeconds,
    maxMoments: maxClips,
  });
  const clips = moments.map((m, i) => {
    const sig = m.signals;
    const scores: ViralScores = {
      hook: clamp(sig.hook * 100),
      curiosity: clamp(sig.build * 100),
      emotion: clamp(sig.peak * 100),
      value: clamp(sig.intensity * 100),
      pacing: clamp(sig.pacing * 100),
    };
    const reasons = [
      sig.hook >= 0.7 && "Opens on action",
      m.arc && sig.peak >= 0.85 && "Builds to a big moment",
      sig.pacing >= 0.6 && "Fast cuts hold attention",
      sig.intensity >= 0.65 && "Intense from start to finish",
      m.clean && "Starts and ends on a scene change",
    ].filter((r): r is string => Boolean(r));
    return {
      id: `${clipId}:m${Math.round(m.start * 2)}`,
      clipId,
      start: m.start,
      end: m.end,
      peak: m.peak,
      score: overallScore(scores),
      scores,
      hook: `Peaks ${mmss(m.peak - m.start)} in`,
      reasons: reasons.length ? reasons : ["Steady energy"],
      title: `Scene ${i + 1} · ${mmss(m.start)}`,
      caption: sig.build >= 0.6 ? "Wait for it… 🔥" : "This scene 🔥",
      hashtags: ["#shorts", "#reels", "#fyp"],
    };
  });
  // Only scenes that stand out: padding the list with ordinary moments makes every pick look random.
  const bar = Math.max(35, (clips[0]?.score ?? 0) * 0.65);
  return clips.filter((c) => c.score >= bar);
}
