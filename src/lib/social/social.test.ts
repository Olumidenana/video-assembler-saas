import { describe, expect, it } from "vitest";
import { schedulePosts, toIcs } from "./plan";
import { shortsTitle, videoResource } from "./youtube-upload";

describe("posting plan", () => {
  const items = ["a", "b", "c"].map((f) => ({ file: `${f}.mp4`, title: `Part ${f}`, caption: "Wait for it, it's worth it\n#fyp" }));

  it("spreads posts over the coming evenings, in order, skipping slots too soon", () => {
    const now = new Date(2026, 9, 6, 18, 30); // 6:30 pm: tonight's 7 pm is too close
    const plan = schedulePosts(items, now);
    expect(plan.map((p) => [p.file, p.at.getDate(), p.at.getHours()])).toEqual([
      ["a.mp4", 7, 19],
      ["b.mp4", 8, 19],
      ["c.mp4", 9, 19],
    ]);
  });

  it("posts twice a day at lunch and in the evening when asked", () => {
    const plan = schedulePosts(items, new Date(2026, 9, 6, 9, 0), 2);
    expect(plan.map((p) => [p.at.getDate(), p.at.getHours()])).toEqual([
      [6, 12],
      [6, 19],
      [7, 12],
    ]);
  });

  it("writes a calendar with a reminder and the caption, escaped", () => {
    const ics = toIcs(schedulePosts(items.slice(0, 1), new Date(Date.UTC(2026, 9, 6, 6))), new Date(Date.UTC(2026, 9, 6, 6)));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Post: Part a");
    expect(ics).toContain("Wait for it\\, it's worth it\\n#fyp");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});

describe("YouTube posting", () => {
  it("tags Shorts and keeps titles within 100 characters", () => {
    expect(shortsTitle("Nobody was ready for this")).toBe("Nobody was ready for this #Shorts");
    expect(shortsTitle("already #shorts")).toBe("already #shorts");
    expect(shortsTitle("x".repeat(120))).toHaveLength(100);
  });

  it("schedules by uploading private with a publish time", () => {
    const at = new Date(Date.now() + 86_400_000);
    expect(videoResource({ title: "t", description: "d", publishAt: at, privacy: "public" }).status).toEqual({ privacyStatus: "private", publishAt: at.toISOString(), selfDeclaredMadeForKids: false });
    expect(videoResource({ title: "t", description: "d", privacy: "public" }).status.privacyStatus).toBe("public");
  });
});
