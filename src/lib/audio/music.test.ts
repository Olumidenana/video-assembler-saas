import { describe, expect, it } from "vitest";
import { encodeWav, MUSIC_STYLES, planTrack } from "./music";

describe("planTrack", () => {
  it.each(MUSIC_STYLES.map((s) => s.id))("%s: drops exactly on the clip's peak", (style) => {
    const plan = planTrack(style, 30, 12.3);
    expect(plan.dropAt).toBe(12.3);
    // Something hits on the drop, and the full beat (a kick or tom) is there too.
    const atDrop = plan.events.filter((e) => Math.abs(e.t - 12.3) < 1e-6).map((e) => e.inst);
    expect(atDrop).toContain("crash");
    const after = plan.events.filter((e) => e.t >= 12.3 && e.t < 12.3 + 60 / plan.bpm * 4);
    expect(after.some((e) => e.inst === "kick" || e.inst === "tom")).toBe(true);
  });

  it("builds up before the drop, with a gap just before it", () => {
    const plan = planTrack("trap", 30, 10);
    expect(plan.events.some((e) => e.inst === "riser" && e.t < 10 && Math.abs(e.t + (e.dur ?? 0) - 10) < 1e-6)).toBe(true);
    expect(plan.events.filter((e) => e.t >= 9.88 && e.t < 10 && e.inst !== "riser")).toEqual([]);
    const kicksBefore = plan.events.filter((e) => e.inst === "kick" && e.t < 9).length;
    const kicksAfter = plan.events.filter((e) => e.inst === "kick" && e.t >= 10 && e.t < 19).length;
    expect(kicksAfter).toBeGreaterThan(kicksBefore);
  });

  it("starts with the full beat when the peak is right at the start", () => {
    const plan = planTrack("phonk", 20, 0.4);
    expect(plan.dropAt).toBe(0);
    expect(plan.events.some((e) => e.inst === "kick" && e.t < 0.1)).toBe(true);
  });

  it("keeps every note inside the clip and is repeatable", () => {
    const a = planTrack("afro", 25, 8, 42);
    expect(a.events.every((e) => e.t >= 0 && e.t < 25)).toBe(true);
    expect(planTrack("afro", 25, 8, 42)).toEqual(a);
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit stereo WAV", () => {
    const left = new Float32Array([0, 0.5, -1, 1]);
    const wav = encodeWav([left, left], 44100);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(16);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32768);
  });
});

describe("trailer pause", () => {
  it("leaves a full beat of silence before the drop, riser included", async () => {
    const { planTrack } = await import("./music");
    const beat = 60 / 90;
    const plan = planTrack("cinematic", 26, 24 * beat, 1, beat);
    const drop = 24 * beat;
    const sounding = plan.events.filter((e) => e.t < drop && (e.t >= drop - beat || e.t + (e.dur ?? 0) > drop - beat + 0.01));
    expect(sounding.filter((e) => e.inst !== "pad" && e.inst !== "keys" && e.inst !== "sub")).toEqual([]);
    expect(plan.events.some((e) => e.inst === "impact" && Math.abs(e.t - drop) < 1e-6)).toBe(true);
  });
});
