/**
 * Hook lines for the first seconds of a short, built on what holds attention
 * in short-form: a curiosity gap (an open question the clip answers), stakes
 * (something is about to change), a pattern interrupt (break the scroll), or a
 * POV / payoff framing. They never claim specifics the editor can't know about
 * the footage (who is in it, what is said), so they stay honest for any video;
 * AI Vision writes specific ones when it can see the clip.
 */
import hooksData from "./knowledge/hooks.json";
import type { ViralClip } from "./viral";

export type HookFamily = "curiosity" | "stakes" | "interrupt" | "payoff";

export const HOOK_LIBRARY: Record<HookFamily, string[]> = {
  curiosity: hooksData.families.curiosity.map((h) => h.template),
  stakes: hooksData.families.stakes.map((h) => h.template),
  interrupt: hooksData.families.interrupt.map((h) => h.template),
  payoff: hooksData.families.payoff.map((h) => h.template),
};

/** Which technique fits a clip, from its measured shape. */
export function hookFamily(scores: ViralClip["scores"]): HookFamily {
  if (scores.curiosity >= 60) return "curiosity"; // energy builds: promise the payoff
  if (scores.emotion >= 85) return "stakes"; // a big peak: something is about to change
  if (scores.pacing >= 60 || scores.hook >= 75) return "interrupt"; // fast and loud from the start
  return "payoff";
}

/**
 * One hook per clip, never repeated within a pack. Talking clips with a short,
 * punchy opening line use their own words (the most honest hook there is).
 */
export function pickHooks(
  clips: Pick<ViralClip, "scores" | "title">[],
  basis: "transcript" | "scenes",
  /** Techniques that suit the audience, best first (see playbooks). */
  preferred: HookFamily[] = ["curiosity", "stakes", "interrupt", "payoff"],
): string[] {
  const used = new Set<string>();
  return clips.map((clip) => {
    if (basis === "transcript") {
      const words = clip.title.trim().split(/\s+/);
      if (clip.title && words.length <= 8) {
        used.add(clip.title);
        return clip.title;
      }
    }
    // The clip's own shape decides, if it's a technique this audience responds to; else the audience's favourite.
    const family = hookFamily(clip.scores);
    const first = preferred.slice(0, 3).includes(family) ? family : preferred[0];
    const order: HookFamily[] = [first, ...preferred.filter((f) => f !== first)];
    for (const f of order) {
      const line = HOOK_LIBRARY[f].find((l) => !used.has(l));
      if (line) {
        used.add(line);
        return line;
      }
    }
    return "Wait for it";
  });
}

