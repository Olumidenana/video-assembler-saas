/**
 * Captions: word timings from speech recognition → styled ASS subtitles that
 * libass (inside FFmpeg) burns into the export. Pure functions.
 */
import type { Canvas } from "./commands";
import { outputStarts } from "./transitions";
import type { ExportItem } from "./types";

export interface Word {
  text: string;
  /** Seconds in the source clip. */
  start: number;
  end: number;
}

export type CaptionStyleId = "clean" | "bold-pop" | "karaoke" | "boxed";

export const CAPTION_STYLES: { id: CaptionStyleId; label: string; studio: boolean; description: string }[] = [
  { id: "clean", label: "Clean", studio: false, description: "White with an outline. Works everywhere." },
  { id: "bold-pop", label: "Bold Pop", studio: true, description: "Big words, current word in yellow. The viral look." },
  { id: "karaoke", label: "Karaoke", studio: true, description: "Words fill with colour as they're spoken." },
  { id: "boxed", label: "Boxed", studio: true, description: "White on a dark box, like the news." },
];

/** ASS colours are &HAABBGGRR. */
const WHITE = "&H00FFFFFF";
const BLACK = "&H00000000";
const YELLOW = "&H0000E5FF";
const SHADOW = "&H80000000";

const pad2 = (n: number) => String(n).padStart(2, "0");
/** ASS timestamps: H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs % 100)}`;
}

const clean = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/**
 * Maps each segment's words onto the output timeline (segments play back to
 * back, overlapping where they blend) and drops anything after `limitSeconds`.
 */
export function wordsForOutput(items: ExportItem[], transcripts: Record<string, Word[]>, limitSeconds = Infinity): Word[] {
  const out: Word[] = [];
  const starts = outputStarts(items);
  for (const [i, item] of items.entries()) {
    const offset = starts[i];
    for (const w of transcripts[item.clipId] ?? []) {
      const mid = (w.start + w.end) / 2;
      if (mid < item.start || mid > item.end) continue;
      const start = offset + Math.max(0, w.start - item.start);
      const end = offset + Math.min(item.end, w.end) - item.start;
      if (start >= limitSeconds) continue;
      out.push({ text: w.text, start, end: Math.min(end, limitSeconds) });
    }
  }
  return out.filter((w) => clean(w.text) && w.end > w.start);
}

/** Groups words into on-screen lines: by word count, characters, pauses and sentence ends. */
export function groupWords(words: Word[], maxWords: number, maxChars: number): Word[][] {
  const groups: Word[][] = [];
  let current: Word[] = [];
  let chars = 0;
  for (const w of words) {
    const text = clean(w.text);
    const prev = current[current.length - 1];
    const pause = prev ? w.start - prev.end > 0.6 : false;
    if (current.length && (current.length >= maxWords || chars + text.length > maxChars || pause)) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(w);
    chars += text.length + 1;
    if (/[.!?]$/.test(text)) {
      groups.push(current);
      current = [];
      chars = 0;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

export interface AssExtras {
  /** Big title over the opening seconds ("the hook"), shown with or without captions. */
  hook?: { text: string; seconds: number };
  /** Closing call to action ("Follow for part 2") from `start` to `end` seconds. */
  outro?: { text: string; start: number; end: number };
  /** Small series label ("PART 1") in the top corner for the whole clip: people follow to see the next part. */
  badge?: { text: string; end: number };
}

export function buildAss(words: Word[], style: CaptionStyleId, canvas: Canvas, extras: AssExtras = {}): string {
  const { width: W, height: H } = canvas;
  const portrait = H > W;
  const base = Math.min(W, H);
  const marginV = Math.round(H * (portrait ? 0.2 : 0.08));
  const marginH = Math.round(W * 0.06);

  const styles: Record<CaptionStyleId, string> = {
    // Name, Font, Size, Primary, Secondary, Outline, Back, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY,
    // Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    clean: `Style: Cap,Montserrat ExtraBold,${Math.round(base * 0.062)},${WHITE},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(base * 0.006))},1,2,${marginH},${marginH},${marginV},1`,
    "bold-pop": `Style: Cap,Anton,${Math.round(base * 0.1)},${WHITE},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,1,0,1,${Math.max(3, Math.round(base * 0.009))},2,2,${marginH},${marginH},${Math.round(H * (portrait ? 0.3 : 0.12))},1`,
    karaoke: `Style: Cap,Montserrat ExtraBold,${Math.round(base * 0.066)},${YELLOW},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(base * 0.006))},1,2,${marginH},${marginH},${marginV},1`,
    boxed: `Style: Cap,Montserrat ExtraBold,${Math.round(base * 0.055)},${WHITE},${WHITE},&H99000000,&H99000000,0,0,0,0,100,100,0,0,3,${Math.max(6, Math.round(base * 0.012))},0,2,${marginH},${marginH},${marginV},1`,
  };

  const events: string[] = [];
  const hook = extras.hook && clean(extras.hook.text).trim();
  if (hook && extras.hook) {
    // Pops in (overshoots slightly, then settles): movement in the first second catches the eye.
    events.push(
      `Dialogue: 1,${assTime(0)},${assTime(extras.hook.seconds)},Hook,,0,0,0,,{\\fad(60,250)\\fscx70\\fscy70\\t(0,180,\\fscx106\\fscy106)\\t(180,280,\\fscx100\\fscy100)}${hook}`,
    );
  }
  const badge = extras.badge && clean(extras.badge.text).trim();
  if (badge && extras.badge) events.push(`Dialogue: 0,${assTime(0)},${assTime(extras.badge.end)},Badge,,0,0,0,,${badge}`);
  const outro = extras.outro && clean(extras.outro.text).trim();
  if (outro && extras.outro && extras.outro.end > extras.outro.start) {
    events.push(
      `Dialogue: 1,${assTime(extras.outro.start)},${assTime(extras.outro.end)},Outro,,0,0,0,,{\\fad(150,0)\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}${outro}`,
    );
  }
  const line = (start: number, end: number, text: string) =>
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`);

  if (style === "bold-pop") {
    // 1–3 words on screen; one event per word so the spoken word lights up.
    for (const group of groupWords(words, 3, 18)) {
      group.forEach((w, i) => {
        const end = i < group.length - 1 ? group[i + 1].start : w.end;
        const text = group
          .map((g, j) => {
            const t = clean(g.text).toUpperCase();
            return j === i ? `{\\c${YELLOW}\\fscx108\\fscy108}${t}{\\c${WHITE}\\fscx100\\fscy100}` : t;
          })
          .join(" ");
        line(w.start, Math.max(end, w.start + 0.05), text);
      });
    }
  } else if (style === "karaoke") {
    for (const group of groupWords(words, 6, 34)) {
      const text = group
        .map((w, i) => {
          const next = group[i + 1];
          const dur = Math.max(1, Math.round(((next ? next.start : w.end) - w.start) * 100));
          return `{\\kf${dur}}${clean(w.text)}`;
        })
        .join(" ");
      line(group[0].start, group[group.length - 1].end, text);
    }
  } else {
    for (const group of groupWords(words, portrait ? 5 : 8, portrait ? 26 : 42)) {
      line(group[0].start, group[group.length - 1].end, group.map((w) => clean(w.text)).join(" "));
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styles[style],
    // Outro: same look as the hook, lower third, so it never covers the hook's spot.
    `Style: Outro,Anton,${Math.round(base * (portrait ? 0.075 : 0.06))},${WHITE},${WHITE},&HA0000000,&HA0000000,0,0,0,0,100,100,1,0,3,${Math.max(8, Math.round(base * 0.016))},0,2,${marginH},${marginH},${Math.round(H * (portrait ? 0.32 : 0.14))},1`,
    // Badge: small, top-left, brand purple box.
    `Style: Badge,Montserrat ExtraBold,${Math.round(base * 0.035)},${WHITE},${WHITE},&H00FF7B8B,&H00FF7B8B,0,0,0,0,100,100,1,0,3,${Math.max(4, Math.round(base * 0.008))},0,7,${Math.round(W * 0.05)},${marginH},${Math.round(H * 0.04)},1`,
    // Hook: Anton, top centre, on a translucent box so it reads over any picture.
    `Style: Hook,Anton,${Math.round(base * (portrait ? 0.085 : 0.07))},${WHITE},${WHITE},&HA0000000,&HA0000000,0,0,0,0,100,100,1,0,3,${Math.max(8, Math.round(base * 0.018))},0,8,${marginH},${marginH},${Math.round(H * (portrait ? 0.12 : 0.07))},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
