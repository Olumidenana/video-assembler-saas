import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MusicStyle } from "@/lib/audio/music";
import type { TransitionType } from "@/lib/video/transitions";
import { sanitizeActions, type EditorAction, type TimelineSummary } from "./actions";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You control a browser-based video editor. The user types a request; you translate it into editor actions.

The editor holds source videos ("clips") and an ordered list of segments cut from them. Exporting joins the segments in order.

Actions (fields not listed for an action must be null):
- highlights {seconds}: automatically find and keep the most interesting moments across all videos (loud speech/music/reactions and on-screen motion), about "seconds" long in total. seconds = null lets the editor choose (~20% of the footage).
- remove_silence: automatically cut out silent or near-silent stretches.
- split_every {seconds, segment}: split a segment (or every segment when segment is null) into parts of this many seconds.
- cut {segment, start, end}: trim "start" seconds off the beginning and "end" seconds off the end of a segment (null segment = first segment for start, last segment for end). Use 0 for the side you don't trim.
- keep_range {segment, start, end}: keep only this part of a segment; start/end are seconds in the segment's source video.
- remove_segment {segment}
- move_segment {segment, to}: move a segment to a new position.
- reset: go back to the full, uncut videos.
- export {mode}: export now. mode "stitch" = one video, "parts" = one file per segment, "none" = keep the current choice.

Segment and position numbers are 1-based, as listed in the timeline. Actions run in order, and segment numbers refer to the timeline as it is when each action runs.
Only use these actions. If the request can't be done with them (for example adding music, captions, filters or transitions), return no actions and say briefly what you can do instead.
"reply" is one short, friendly sentence telling the user what you did, in plain language.`;

const ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "actions"],
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "seconds", "segment", "start", "end", "to", "mode"],
        properties: {
          type: {
            type: "string",
            enum: ["highlights", "remove_silence", "split_every", "cut", "keep_range", "remove_segment", "move_segment", "reset", "export"],
          },
          seconds: { type: ["number", "null"] },
          segment: { type: ["integer", "null"] },
          start: { type: ["number", "null"] },
          end: { type: ["number", "null"] },
          to: { type: ["integer", "null"] },
          mode: { type: "string", enum: ["stitch", "parts", "none"] },
        },
      },
    },
  },
} as const;

export class AssistantError extends Error {}

export async function planActions(command: string, timeline: TimelineSummary): Promise<{ reply: string; actions: EditorAction[] }> {
  const client = new Anthropic({ timeout: 20_000, maxRetries: 1 });

  const clipList = timeline.clips.map((c, i) => `${i + 1}. "${c.name}" (${c.duration.toFixed(1)}s)`).join("\n") || "(none)";
  const segmentList =
    timeline.segments.map((s, i) => `${i + 1}. from "${s.clip}", ${s.start.toFixed(1)}s–${s.end.toFixed(1)}s`).join("\n") || "(none)";

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    // A short, well-specified translation task: low effort keeps it fast and cheap.
    output_config: { effort: "low", format: { type: "json_schema", schema: ACTION_SCHEMA } },
    // If the model declines, Anthropic retries on a recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Videos:\n${clipList}\n\nCurrent segments:\n${segmentList}\n\nRequest: ${command}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new AssistantError("I can't help with that request.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AssistantError("No answer from the assistant.");

  let parsed: { reply?: unknown; actions?: unknown };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new AssistantError("The assistant's answer couldn't be read.");
  }
  return {
    reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 300) : "Done.",
    actions: sanitizeActions(parsed.actions),
  };
}

const VIRAL_SYSTEM = `You are a short-form content strategist for Reels, TikTok, YouTube Shorts and WhatsApp Status. You pick the moments from a long video that are most likely to stop the scroll and be watched to the end.

Judge with content psychology backed by empirical Shorts research (VVSA > 70% threshold):
- Hook (first 1.5-2.0 seconds): viewers decide within 1.8s before the swipe cliff. Pattern interrupts, bold claims, questions, "you"-language, specific numbers, high stakes. The first sentence must work with no context. On-screen hook text must be punchy (at most 6 words). Never open on introductions, greetings, or dead air.
- Comedy & Skits: NEVER use a cold open or flash-forward that spoils the punchline. Preserve setup tension and protect the 0.5s pre-punchline pause.
- Curiosity gap & Open Loops: open loops that make people stay for the answer; do not give the payoff early.
- Emotion: humour, surprise, outrage, inspiration, relatability, high-energy delivery.
- Value / payoff: a clear takeaway, story resolution, punchline or lesson by the end.
- Pacing and standalone sense: no dead air, brisk cuts (>0.8 cuts/sec in builds), no references to things the viewer didn't see.
- Loops & Outros: reward seamless loops where the final line connects back to the opening hook, or debate/question CTAs that drive comment sections.

The transcript is split into numbered sentences with timestamps. Each clip is a contiguous run of sentences (start_sentence..end_sentence inclusive) within the requested length. Clips must not overlap. Prefer starting on a sentence that works as a hook.

For each clip, write: a scroll-stopping title (max 70 characters), a social caption (1-2 short sentences, may include one emoji), 3-6 relevant hashtags, and 1-3 short reasons naming the psychology at work. Score each dimension 0-100 honestly; most moments are average.

Work in the language of the transcript (including Nigerian Pidgin).`;

const VIRAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clips"],
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start_sentence", "end_sentence", "hook", "curiosity", "emotion", "value", "pacing", "reasons", "title", "caption", "hashtags"],
        properties: {
          start_sentence: { type: "integer" },
          end_sentence: { type: "integer" },
          hook: { type: "integer" },
          curiosity: { type: "integer" },
          emotion: { type: "integer" },
          value: { type: "integer" },
          pacing: { type: "integer" },
          reasons: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export interface ViralPick {
  startSentence: number;
  endSentence: number;
  scores: { hook: number; curiosity: number; emotion: number; value: number; pacing: number };
  reasons: string[];
  title: string;
  caption: string;
  hashtags: string[];
}

/** Asks Claude to pick and package the most viral moments from a transcript. */
export async function planViralClips(
  sentences: { text: string; start: number; end: number }[],
  { minSeconds, maxSeconds, count }: { minSeconds: number; maxSeconds: number; count: number },
): Promise<ViralPick[]> {
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const transcript = sentences.map((s, i) => `[${i}] (${s.start.toFixed(1)}-${s.end.toFixed(1)}s) ${s.text}`).join("\n");

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: VIRAL_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: VIRAL_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Find up to ${count} clips, each ${minSeconds}-${maxSeconds} seconds long, best first.\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new AssistantError("I can't help with that video.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AssistantError("No answer from the assistant.");
  let parsed: { clips?: unknown };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new AssistantError("The assistant's answer couldn't be read.");
  }

  const n = sentences.length;
  const score = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50);
  const strings = (v: unknown, max: number, len: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, len)) : [];

  return (Array.isArray(parsed.clips) ? parsed.clips : [])
    .slice(0, count)
    .flatMap((c: Record<string, unknown>) => {
      const a = Number(c.start_sentence);
      const b = Number(c.end_sentence);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= n) return [];
      return [
        {
          startSentence: a,
          endSentence: b,
          scores: { hook: score(c.hook), curiosity: score(c.curiosity), emotion: score(c.emotion), value: score(c.value), pacing: score(c.pacing) },
          reasons: strings(c.reasons, 3, 60),
          title: typeof c.title === "string" ? c.title.slice(0, 80) : "",
          caption: typeof c.caption === "string" ? c.caption.slice(0, 300) : "",
          hashtags: strings(c.hashtags, 6, 40).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
        },
      ];
    });
}

/** One candidate clip for AI Vision: its timing, what the editor measured, and a few frames. */
export interface VisionCandidate {
  id: string;
  start: number;
  end: number;
  /** Short context from the editor, e.g. measured signals or the opening line. */
  notes: string;
  /** JPEG frames, base64, in time order. */
  frames: string[];
}

export interface VisionVerdict {
  id: string;
  /** 0–100: how likely to hold attention and get shared. */
  score: number;
  /** One line: what actually happens in the clip. */
  what: string;
  /** One line: why it would (or wouldn't) work as a short. */
  why: string;
  /** Overlay text for the first seconds: a few words, no emoji. */
  hook: string;
  title: string;
  caption: string;
  hashtags: string[];
  /** False when the clip isn't worth posting (dull, confusing, mid-action cut). */
  keep: boolean;
}

const VISION_SYSTEM = `You are a short-form video editor who has grown many TikTok, Reels and Shorts accounts. You are shown candidate clips from one longer video, each as a few frames in time order, with notes the editing software measured.

Judge each clip as a stand-alone short:
- What actually happens in it, from the frames (actions, expressions, reveals, text on screen, setting).
- Framing & Safe Zone: check that faces or points of focus sit in the upper 40-60% vertical safe zone, clear of TikTok/Shorts UI overlays (right edge action buttons, bottom caption space).
- Hook & 1.8s Cliff: would the first 1-2 frames make someone stop scrolling? Look for immediate action, facial reaction, or visual anomaly before the 1.8s retention cliff.
- Payoff: does something happen by the end, or does it fizzle or cut off mid-action? For comedy, ensure the punchline is preserved and not spoiled in early frames.
- Clarity: would it make sense to someone who hasn't seen the full video?
- Emotion and shareability: funny, shocking, impressive, relatable, satisfying.

Be honest. Score 0-100 relative to typical short-form performance, not relative to each other. Mark keep=false for clips that are dull, confusing, or end before the payoff. Only describe what is visible; if the frames are unclear, say so rather than guessing.

For each clip write:
- what: one plain sentence describing what happens.
- why: one sentence on why it would or wouldn't work as a short.
- hook: overlay text for the first 3 seconds, at most 6 words, no emoji, no hashtags. Viewers decide within about 1.5 seconds, so it must open a loop the clip closes. Use one technique that fits what you see: a curiosity gap ("Watch what happens when..."), stakes or a turning point ("This is where it all flips"), a pattern interrupt ("Don't blink"), a POV ("POV: you finally..."), or a specific outcome. Never use a greeting or setup, never promise something the clip doesn't deliver.
- title: a post title (max 70 characters).
- caption: a post caption (1-2 sentences) that matches the clip and invites a comment (a question or a take people will want to answer).
- hashtags: 3-5 relevant hashtags.`;

const VISION_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer" },
          what: { type: "string" },
          why: { type: "string" },
          hook: { type: "string" },
          title: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          keep: { type: "boolean" },
        },
        required: ["id", "score", "what", "why", "hook", "title", "caption", "hashtags", "keep"],
        additionalProperties: false,
      },
    },
  },
  required: ["clips"],
  additionalProperties: false,
};

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** AI Vision: Claude looks at a few frames from each candidate and judges and writes it. */
export async function judgeClipsVisually(candidates: VisionCandidate[], audience?: string): Promise<VisionVerdict[]> {
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const who = audience?.trim()
    ? ` These posts are for this audience; judge, pick and write for what they reward: ${audience.trim()}`
    : "";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `${candidates.length} candidate clips follow. Judge each one.${who}` },
  ];
  for (const c of candidates) {
    content.push({
      type: "text",
      text: `Clip id "${c.id}": ${mmss(c.start)}-${mmss(c.end)} (${Math.round(c.end - c.start)} s). Notes: ${c.notes}. ${c.frames.length} frames in time order:`,
    });
    for (const data of c.frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  }

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: VISION_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: VISION_SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new AssistantError("AI Vision can't review this video.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AssistantError("No answer from AI Vision.");
  let parsed: { clips?: unknown };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new AssistantError("AI Vision's answer couldn't be read.");
  }

  const ids = new Set(candidates.map((c) => c.id));
  const str = (v: unknown, len: number) => (typeof v === "string" ? v.trim().slice(0, len) : "");
  return (Array.isArray(parsed.clips) ? parsed.clips : []).flatMap((c: Record<string, unknown>) => {
    if (typeof c.id !== "string" || !ids.has(c.id)) return [];
    ids.delete(c.id); // first verdict per clip wins
    const score = typeof c.score === "number" && Number.isFinite(c.score) ? Math.max(0, Math.min(100, Math.round(c.score))) : 50;
    return [
      {
        id: c.id,
        score,
        what: str(c.what, 200),
        why: str(c.why, 200),
        // The caption fonts can't draw emoji; keep the overlay short.
        hook: str(c.hook, 60).replace(/\p{Extended_Pictographic}|️/gu, "").trim(),
        title: str(c.title, 80),
        caption: str(c.caption, 300),
        hashtags: (Array.isArray(c.hashtags) ? c.hashtags : [])
          .filter((h): h is string => typeof h === "string")
          .slice(0, 6)
          .map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "").slice(0, 40)),
        keep: c.keep !== false,
      },
    ];
  });
}

/** One moment offered to AI Theme Match: which video it's from, when, its measured feel, and a few frames. */
export interface ThemeCandidate {
  id: string;
  /** Which source video, e.g. "Video 2 (naruto-ep-133.mp4)". */
  video: string;
  start: number;
  end: number;
  /** Measured feel and anything said in it. */
  notes: string;
  frames: string[];
}

export interface ThemeMashup {
  title: string;
  /** The shared theme in a few words ("rivals who respect each other"). */
  theme: string;
  why: string;
  hook: string;
  /** Moment ids in play order. */
  ids: string[];
  music: MusicStyle;
  transition: TransitionType;
}

const THEME_MUSIC = ["phonk", "trap", "afro", "cinematic", "lofi"] as const satisfies readonly MusicStyle[];
const THEME_TRANSITIONS = ["fadewhite", "smoothleft", "zoomin", "hblur", "fade", "fadeblack", "circleopen"] as const satisfies readonly TransitionType[];

const THEME_SYSTEM = `You are an editor who makes viral fan edits and mashups (anime, films, series, games, sports). You are shown short moments from several different videos, each as a few frames in time order, with the feel the editing software measured.

Group moments from DIFFERENT videos that share a theme or say the same thing, so cutting between them makes a mashup fans want to share. Strong themes: rivals or enemies who become allies, sacrifice, betrayal, a mentor or a loss, training and never giving up, a power awakening or transformation, the underdog rising, friendship and loyalty, revenge, the calm before the storm. Visual rhymes work too: the same pose, gesture, shot or action across videos (two characters both screaming, both falling, both looking at the sky).

Rules:
- Each mashup uses 3 to 8 moments from at least 2 different videos. A moment can be in more than one mashup.
- Order them as a dynamic story: open on 2 establishing shots with a hook that stops the scroll, build momentum with accelerating montage cuts, and land the strongest thematic climax exactly on the beat drop.
- For endings: design the final clip to loop back seamlessly to the opening shot (infinite watch loop) or end with an on-screen debate prompt that triggers comments ("Who wins?", "Which side are you on?").
- Only group what the frames actually show. If nothing truly shares a theme, return fewer mashups or none.
- Give up to 3 mashups, best first.

For each mashup write:
- title: a short name (max 40 characters).
- theme: the shared theme in a few words.
- why: one sentence on why these moments belong together and why fans would share it.
- hook: overlay text for the first 3 seconds, at most 6 words, no emoji, that opens a loop the edit closes.
- ids: the moment ids in play order.
- music: phonk (aggressive fights, hype, 130 BPM), trap (hard energy, 140 BPM), cinematic (epic or emotional swells and reveals, 90 BPM), lofi (sad, nostalgic, quiet, 80 BPM), or afro (light, fun, 112 BPM).
- transition: fadewhite (flash cut for impacts), smoothleft (fast whip), zoomin (hype and reveals), hblur (smooth motion), fade (emotional dissolve), fadeblack (endings and time jumps), circleopen (iris).`;

const THEME_SCHEMA = {
  type: "object",
  properties: {
    mashups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          theme: { type: "string" },
          why: { type: "string" },
          hook: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
          music: { type: "string", enum: [...THEME_MUSIC] },
          transition: { type: "string", enum: [...THEME_TRANSITIONS] },
        },
        required: ["title", "theme", "why", "hook", "ids", "music", "transition"],
        additionalProperties: false,
      },
    },
  },
  required: ["mashups"],
  additionalProperties: false,
};

/** AI Theme Match: Claude looks at moments from several videos and groups the ones that share a theme into mashups. */
export async function matchThemes(candidates: ThemeCandidate[]): Promise<ThemeMashup[]> {
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `${candidates.length} moments from ${new Set(candidates.map((c) => c.video)).size} videos follow. Group them into mashups.` },
  ];
  for (const c of candidates) {
    content.push({
      type: "text",
      text: `Moment id "${c.id}" from ${c.video}, ${mmss(c.start)}-${mmss(c.end)} (${Math.round(c.end - c.start)} s). Notes: ${c.notes}. ${c.frames.length} frames:`,
    });
    for (const data of c.frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  }

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 6000,
    output_config: { effort: "low", format: { type: "json_schema", schema: THEME_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: THEME_SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new AssistantError("AI Theme Match can't review these videos.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AssistantError("No answer from AI Theme Match.");
  let parsed: { mashups?: unknown };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new AssistantError("AI Theme Match's answer couldn't be read.");
  }

  const videoOf = new Map(candidates.map((c) => [c.id, c.video]));
  const str = (v: unknown, len: number) => (typeof v === "string" ? v.trim().slice(0, len) : "");
  return (Array.isArray(parsed.mashups) ? parsed.mashups : []).slice(0, 3).flatMap((m: Record<string, unknown>) => {
    const ids = [...new Set((Array.isArray(m.ids) ? m.ids : []).filter((id): id is string => typeof id === "string" && videoOf.has(id)))].slice(0, 8);
    // A mashup cuts between videos; anything less isn't one.
    if (ids.length < 3 || new Set(ids.map((id) => videoOf.get(id))).size < 2) return [];
    return [
      {
        title: str(m.title, 50) || "Theme mashup",
        theme: str(m.theme, 80),
        why: str(m.why, 240),
        hook: str(m.hook, 60).replace(/\p{Extended_Pictographic}|️/gu, "").trim(),
        ids,
        music: THEME_MUSIC.find((x) => x === m.music) ?? "cinematic",
        transition: THEME_TRANSITIONS.find((x) => x === m.transition) ?? "fade",
      },
    ];
  });
}
