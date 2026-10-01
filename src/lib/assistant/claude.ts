import "server-only";
import Anthropic from "@anthropic-ai/sdk";
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

Judge with content psychology:
- Hook (first 1-3 seconds): pattern interrupts, bold claims, questions, "you"-language, specific numbers, conflict. The first sentence must work with no context.
- Curiosity gap: open loops that make people stay for the answer.
- Emotion: humour, surprise, outrage, inspiration, relatability, high-energy delivery.
- Value / payoff: a clear takeaway, story resolution, punchline or lesson by the end.
- Pacing and standalone sense: no dead air, no references to things the viewer didn't see.

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
