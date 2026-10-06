/**
 * Hook lines for the first seconds of a short, built on what holds attention
 * in short-form: a curiosity gap (an open question the clip answers), stakes
 * (something is about to change), a pattern interrupt (break the scroll), or a
 * POV / payoff framing. They never claim specifics the editor can't know about
 * the footage (who is in it, what is said), so they stay honest for any video;
 * AI Vision writes specific ones when it can see the clip.
 */
import type { ViralClip } from "./viral";

export type HookFamily = "curiosity" | "stakes" | "interrupt" | "payoff";

export const HOOK_LIBRARY: Record<HookFamily, string[]> = {
  curiosity: [
    "Wait for the last 3 seconds",
    "Watch the ending closely",
    "Keep watching. Trust me.",
    "You won't see it coming",
    "It gets better at the end",
  ],
  stakes: [
    "Nobody was ready for this",
    "This changed everything",
    "The moment it all flipped",
    "This is where it gets real",
    "No one saw this coming",
  ],
  interrupt: [
    "Stop scrolling. Watch this.",
    "Don't blink",
    "0 to 100 in seconds",
    "Turn the sound up for this",
    "This goes hard",
  ],
  payoff: [
    "The scene everyone replays",
    "Rate this 1 to 10",
    "This is peak",
    "Save this one",
    "Hardest moment, no contest?",
  ],
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
export function pickHooks(clips: Pick<ViralClip, "scores" | "title">[], basis: "transcript" | "scenes"): string[] {
  const used = new Set<string>();
  return clips.map((clip) => {
    if (basis === "transcript") {
      const words = clip.title.trim().split(/\s+/);
      if (clip.title && words.length <= 8) {
        used.add(clip.title);
        return clip.title;
      }
    }
    const family = hookFamily(clip.scores);
    const order: HookFamily[] = [family, ...(["curiosity", "stakes", "interrupt", "payoff"] as const).filter((f) => f !== family)];
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

/** The closing call to action: a reason to follow, which is what grows an account. */
export const OUTRO_LINES = {
  edit: "Follow for part 2",
  podcast: "Follow for more like this",
  story: "Follow for part 2",
} as const;
