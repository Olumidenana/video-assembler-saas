import { describe, expect, it } from "vitest";
import { SOUND_EFFECTS } from "./sfx";

describe("SOUND_EFFECTS", () => {
  it("defines viral sound effects library with files and metadata", () => {
    expect(SOUND_EFFECTS.length).toBeGreaterThanOrEqual(5);
    const stinger = SOUND_EFFECTS.find((s) => s.id === "auracut_stinger");
    expect(stinger).toBeDefined();
    expect(stinger?.badge).toBe("Signature");
    expect(stinger?.file).toBe("/audio/sfx/auracut_stinger.wav");

    for (const sfx of SOUND_EFFECTS) {
      expect(sfx.file).toMatch(/^\/audio\/sfx\/.+\.wav$/);
      expect(sfx.duration).toBeGreaterThan(0);
      expect(sfx.label.length).toBeGreaterThan(0);
    }
  });
});
