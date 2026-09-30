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
