import { describe, expect, it } from "vitest";
import formatsData from "./formats.json";
import hooksData from "./hooks.json";
import nichesData from "./niches.json";
import musicData from "./music.json";
import ctasData from "./ctas.json";

describe("Assistant Knowledge Base Schema Validation", () => {
  it("validates formats.json structure, ranges, and sources", () => {
    expect(formatsData.version).toBe("1.0.0");
    expect(formatsData.formats).toBeDefined();

    const formatKeys = Object.keys(formatsData.formats);
    expect(formatKeys.length).toBeGreaterThanOrEqual(5);

    interface FormatEntry {
      name: string;
      niches: string[];
      totalLengthRange: { min: number; max: number };
      sections: unknown[];
      sources: string[];
      n: number;
    }
    for (const key of formatKeys) {
      const format = (formatsData.formats as Record<string, FormatEntry>)[key];
      expect(format.name).toBeTruthy();
      expect(Array.isArray(format.niches)).toBe(true);
      expect(format.totalLengthRange.min).toBeGreaterThan(0);
      expect(format.totalLengthRange.max).toBeGreaterThanOrEqual(format.totalLengthRange.min);
      expect(Array.isArray(format.sections)).toBe(true);
      expect(format.sections.length).toBeGreaterThan(0);

      // Verify sources and sample count
      expect(Array.isArray(format.sources)).toBe(true);
      expect(format.sources.length).toBeGreaterThanOrEqual(1);
      expect(format.n).toBeGreaterThan(0);

      // Verify URLs
      for (const src of format.sources) {
        expect(src).toMatch(/^https:\/\/www\.youtube\.com\/shorts\//);
      }
    }
  });

  it("validates hooks.json structure, word counts, and sources", () => {
    expect(hooksData.version).toBe("1.0.0");
    expect(hooksData.families).toBeDefined();

    interface HookEntry {
      template: string;
      sources: string[];
      n: number;
    }
    const families = ["curiosity", "stakes", "interrupt", "payoff"] as const;
    for (const fam of families) {
      const list = (hooksData.families as Record<string, HookEntry[]>)[fam];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(4);

      for (const item of list) {
        expect(item.template).toBeTruthy();
        const wordCount = item.template.trim().split(/\s+/).length;
        // Max 6 words per template rule
        expect(wordCount).toBeLessThanOrEqual(6);
        expect(Array.isArray(item.sources)).toBe(true);
        expect(item.sources.length).toBeGreaterThanOrEqual(1);
        expect(item.n).toBeGreaterThan(0);
      }
    }

    // Verify trailer title triads
    expect(Array.isArray(hooksData.trailerTriads)).toBe(true);
    expect(hooksData.trailerTriads.length).toBeGreaterThanOrEqual(3);
    for (const item of hooksData.trailerTriads) {
      expect(item.triad.length).toBe(3);
      expect(Array.isArray(item.sources)).toBe(true);
      expect(item.sources.length).toBeGreaterThanOrEqual(1);
      expect(item.n).toBeGreaterThan(0);
    }
  });

  it("validates niches.json structure, ranges, and sources", () => {
    expect(nichesData.version).toBe("1.0.0");
    expect(nichesData.niches).toBeDefined();

    interface NicheEntry {
      label: string;
      emoji: string;
      audience: string;
      kind: string;
      range: { min: number; max: number };
      weights: { hook: number; curiosity: number; emotion: number; value: number; pacing: number };
      bpmRange: { min: number; max: number };
      coldOpen: boolean;
      cta: string;
      sources: string[];
      n: number;
    }
    const nicheKeys = Object.keys(nichesData.niches);
    expect(nicheKeys.length).toBeGreaterThanOrEqual(7);

    for (const key of nicheKeys) {
      const niche = (nichesData.niches as Record<string, NicheEntry>)[key];
      expect(niche.label).toBeTruthy();
      expect(niche.emoji).toBeTruthy();
      expect(niche.audience).toBeTruthy();
      expect(["scenes", "talking"]).toContain(niche.kind);
      expect(niche.range.min).toBeGreaterThan(0);
      expect(niche.range.max).toBeGreaterThanOrEqual(niche.range.min);

      // Weights must sum to approx 1.0 (0.95 - 1.05)
      const w = niche.weights;
      const sum = w.hook + w.curiosity + w.emotion + w.value + w.pacing;
      expect(sum).toBeGreaterThanOrEqual(0.95);
      expect(sum).toBeLessThanOrEqual(1.05);

      expect(niche.bpmRange.min).toBeGreaterThan(50);
      expect(niche.bpmRange.max).toBeGreaterThanOrEqual(niche.bpmRange.min);
      expect(typeof niche.coldOpen).toBe("boolean");
      expect(niche.cta).toBeTruthy();

      expect(Array.isArray(niche.sources)).toBe(true);
      expect(niche.sources.length).toBeGreaterThanOrEqual(1);
      expect(niche.n).toBeGreaterThan(0);
    }
  });

  it("validates music.json genres, BPM ranges, and pre-drop silence", () => {
    expect(musicData.version).toBe("1.0.0");
    expect(musicData.genres).toBeDefined();

    interface GenreEntry {
      label: string;
      bpmRange: { min: number; max: number; default: number };
      preDropSilenceSeconds: number;
      sources: string[];
      n: number;
    }
    const genres = ["phonk", "trap", "afro", "cinematic", "lofi"] as const;
    for (const genre of genres) {
      const g = (musicData.genres as Record<string, GenreEntry>)[genre];
      expect(g.label).toBeTruthy();
      expect(g.bpmRange.min).toBeGreaterThanOrEqual(60);
      expect(g.bpmRange.max).toBeGreaterThanOrEqual(g.bpmRange.min);
      expect(g.bpmRange.default).toBeGreaterThanOrEqual(g.bpmRange.min);
      expect(g.bpmRange.default).toBeLessThanOrEqual(g.bpmRange.max);
      expect(g.preDropSilenceSeconds).toBeGreaterThanOrEqual(0);
      expect(g.preDropSilenceSeconds).toBeLessThanOrEqual(1.0);

      expect(Array.isArray(g.sources)).toBe(true);
      expect(g.sources.length).toBeGreaterThanOrEqual(1);
      expect(g.n).toBeGreaterThan(0);
    }
  });

  it("validates ctas.json call-to-action rules and sources", () => {
    expect(ctasData.version).toBe("1.0.0");
    expect(Array.isArray(ctasData.ctas)).toBe(true);
    expect(ctasData.ctas.length).toBeGreaterThanOrEqual(6);

    for (const cta of ctasData.ctas) {
      expect(cta.text).toBeTruthy();
      expect(cta.type).toBeTruthy();
      expect(cta.niche).toBeTruthy();
      expect(Array.isArray(cta.sources)).toBe(true);
      expect(cta.sources.length).toBeGreaterThanOrEqual(1);
      expect(cta.n).toBeGreaterThan(0);
    }
  });
});
