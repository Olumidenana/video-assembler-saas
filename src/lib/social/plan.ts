/**
 * Posting plan: spreads finished clips over the coming days at times people
 * scroll most (lunch and the evening), and writes a calendar file so each
 * post comes with a reminder and its caption. Posting steadily (one or two a
 * day, parts in order) beats dumping them all at once. Pure functions.
 */

export interface PlanItem {
  file: string;
  title: string;
  caption: string;
}

export interface PlannedPost extends PlanItem {
  at: Date;
}

/** Local times to post: once a day in the evening, or at lunch and in the evening. */
export const POST_TIMES: Record<1 | 2, [number, number][]> = {
  1: [[19, 0]],
  2: [
    [12, 30],
    [19, 0],
  ],
};

/** The next slots from `now` on (skipping any within the hour), one item per slot, in order. */
export function schedulePosts(items: PlanItem[], now: Date, perDay: 1 | 2 = 1): PlannedPost[] {
  const out: PlannedPost[] = [];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let d = 0; out.length < items.length && d < 366; d++) {
    for (const [h, m] of POST_TIMES[perDay]) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d, h, m);
      if (at.getTime() < now.getTime() + 3600_000) continue;
      if (out.length < items.length) out.push({ ...items[out.length], at });
    }
  }
  return out;
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 characters are folded, as the calendar format requires. */
function fold(line: string): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? " " : "") + line.slice(i, i + 73));
  return parts.join("\r\n");
}

/** An .ics calendar: one 15-minute event per post with the caption, and a reminder 10 minutes before. */
export function toIcs(posts: PlannedPost[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Anti-Timeout//Posting plan//EN", "CALSCALE:GREGORIAN"];
  posts.forEach((p, i) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsDate(now)}-${i}@anti-timeout`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(p.at)}`,
      "DURATION:PT15M",
      fold(`SUMMARY:${icsText(`Post: ${p.title}`)}`),
      fold(`DESCRIPTION:${icsText(`File: ${p.file}\n\n${p.caption}`)}`),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      fold(`DESCRIPTION:${icsText(`Time to post ${p.title}`)}`),
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
