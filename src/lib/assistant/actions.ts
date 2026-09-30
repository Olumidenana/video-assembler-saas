/**
 * The editor's command vocabulary, shared by the local parser (instant, free)
 * and the Claude-backed assistant (for anything the parser doesn't understand).
 * Segment numbers are 1-based, as shown in the UI.
 */
export type EditorAction =
  | { type: "highlights"; seconds: number | null }
  | { type: "remove_silence" }
  | { type: "split_every"; seconds: number; segment: number | null }
  | { type: "cut"; segment: number | null; fromStart: number; fromEnd: number }
  | { type: "keep_range"; segment: number; start: number; end: number }
  | { type: "remove_segment"; segment: number }
  | { type: "move_segment"; segment: number; to: number }
  | { type: "reset" }
  | { type: "export"; mode: "stitch" | "parts" | null };

export interface TimelineSummary {
  clips: { name: string; duration: number }[];
  segments: { clip: string; start: number; end: number }[];
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b`;

function toSeconds(value: string, unit: string): number {
  return unit.startsWith("m") ? Number(value) * 60 : Number(value);
}

function durationIn(text: string): number | null {
  const m = new RegExp(`${NUM}${UNIT}`, "i").exec(text);
  return m ? toSeconds(m[1], m[2]) : null;
}

/** Parses one instruction ("make a 30 second highlight"). */
function parseOne(raw: string): EditorAction | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  if (/\b(undo everything|start over|reset|restore|original)\b/.test(text)) return { type: "reset" };

  if (/(silen|dead air|pauses|quiet parts|awkward gaps)/.test(text)) return { type: "remove_silence" };

  if (/(highlight|best (part|bit|moment|scene)|recap|reel|summar|trailer|most interesting|exciting)/.test(text)) {
    return { type: "highlights", seconds: durationIn(text) };
  }

  const split = /\b(split|chop|divide|break|cut)\b.*\b(into|every|parts|pieces|chunks|segments|clips)\b/.test(text);
  const seconds = durationIn(text);
  if (split && seconds) return { type: "split_every", seconds, segment: null };

  const edge = new RegExp(`\\b(remove|cut|trim|delete|drop|skip)\\b.*\\b(first|last|start|end|beginning|opening|ending)\\b`).exec(text);
  if (edge && seconds) {
    const fromEnd = /\b(last|end|ending)\b/.test(text);
    return { type: "cut", segment: null, fromStart: fromEnd ? 0 : seconds, fromEnd: fromEnd ? seconds : 0 };
  }

  if (/\b(export|download|render|save|finish|done)\b/.test(text)) {
    const parts = /\b(separate|each|individual|parts|pieces|files)\b/.test(text);
    return { type: "export", mode: parts ? "parts" : /\b(one|single|stitch|join|merge|together)\b/.test(text) ? "stitch" : null };
  }

  return null;
}

/**
 * Understands common commands without calling the AI, including chains like
 * "remove silences then make a 30s highlight and export". Returns null when
 * any part isn't recognised, so the whole request can go to the assistant.
 */
export function parseCommandLocally(input: string): EditorAction[] | null {
  const parts = input
    .split(/\s*(?:,|;|\.|\band then\b|\bthen\b|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return null;
  const actions: EditorAction[] = [];
  for (const part of parts) {
    const action = parseOne(part);
    if (!action) return null;
    actions.push(action);
  }
  return actions;
}

/** Checks and cleans actions from the model; anything malformed is dropped. */
export function sanitizeActions(raw: unknown): EditorAction[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, min = 0, max = 36_000) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
  const index = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 500 ? v : null);

  const out: EditorAction[] = [];
  for (const a of raw.slice(0, 8) as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    switch (a.type) {
      case "highlights":
        out.push({ type: "highlights", seconds: num(a.seconds, 1) });
        break;
      case "remove_silence":
        out.push({ type: "remove_silence" });
        break;
      case "split_every": {
        const seconds = num(a.seconds, 1);
        if (seconds) out.push({ type: "split_every", seconds, segment: index(a.segment) });
        break;
      }
      case "cut": {
        const fromStart = num(a.start) ?? 0;
        const fromEnd = num(a.end) ?? 0;
        if (fromStart || fromEnd) out.push({ type: "cut", segment: index(a.segment), fromStart, fromEnd });
        break;
      }
      case "keep_range": {
        const segment = index(a.segment);
        const start = num(a.start);
        const end = num(a.end);
        if (segment && start !== null && end !== null && end > start) out.push({ type: "keep_range", segment, start, end });
        break;
      }
      case "remove_segment": {
        const segment = index(a.segment);
        if (segment) out.push({ type: "remove_segment", segment });
        break;
      }
      case "move_segment": {
        const segment = index(a.segment);
        const to = index(a.to);
        if (segment && to) out.push({ type: "move_segment", segment, to });
        break;
      }
      case "reset":
        out.push({ type: "reset" });
        break;
      case "export":
        out.push({ type: "export", mode: a.mode === "stitch" || a.mode === "parts" ? a.mode : null });
        break;
    }
  }
  return out;
}

/** One-line, human-readable description of an action, for the assistant's reply. */
export function describeAction(a: EditorAction): string {
  switch (a.type) {
    case "highlights":
      return a.seconds ? `Find the best ${a.seconds}s` : "Find the best moments";
    case "remove_silence":
      return "Remove silent parts";
    case "split_every":
      return `Split ${a.segment ? `segment ${a.segment}` : "everything"} into ${a.seconds}s parts`;
    case "cut":
      return [a.fromStart && `cut the first ${a.fromStart}s`, a.fromEnd && `cut the last ${a.fromEnd}s`].filter(Boolean).join(" and ");
    case "keep_range":
      return `Keep ${a.start}s–${a.end}s of segment ${a.segment}`;
    case "remove_segment":
      return `Remove segment ${a.segment}`;
    case "move_segment":
      return `Move segment ${a.segment} to position ${a.to}`;
    case "reset":
      return "Start over from the original videos";
    case "export":
      return a.mode === "parts" ? "Export each segment" : "Export";
  }
}
