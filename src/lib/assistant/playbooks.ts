/**
 * Audience playbooks: what each kind of viewer rewards, and how a clip for
 * them should be picked, cut and packaged. Drawn from short-form research:
 * anime fans share fights, power-ups/transformations, plot twists and
 * emotional climaxes cut to the beat; podcast clips win with hot takes,
 * emotional stories and practical advice that open on the strongest line;
 * comedy needs 18-28 s and a punchline that lands at the end (never spoiled
 * up front); gaming and sports start mid-action and pay off with the clutch
 * moment or big play.
 */
import type { MusicStyle } from "@/lib/audio/music";
import type { CaptionStyleId } from "@/lib/video/captions";
import type { HookFamily } from "./hooks";
import type { ViralScores } from "./viral";

export type PlaybookId = "anime" | "gaming" | "sports" | "podcast" | "comedy" | "motivation" | "vlog";

export interface Playbook {
  id: PlaybookId;
  label: string;
  emoji: string;
  /** What the audience rewards, shown to the user and given to AI Vision. */
  audience: string;
  /** "scenes" = judged on the edit; "talking" = on what's said. */
  kind: "scenes" | "talking" | "auto";
  range: { min: number; max: number; label: string };
  /** Signal weights. For scene clips: hook, curiosity = build-up, emotion = peak, value = intensity, pacing. */
  weights: ViralScores;
  /** Hook techniques that suit this audience, best first. */
  hooks: HookFamily[];
  /** Music for a clip, from its measured shape. */
  music: (scores: ViralScores) => MusicStyle | "none";
  musicVolume: number;
  captions: boolean;
  captionStyle: CaptionStyleId;
  /** Flash-forward cold open. Off for comedy: showing the punchline first kills it. */
  coldOpen: boolean;
  outro: string;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "anime",
    label: "Anime",
    emoji: "⚔️",
    audience: "Anime fans share fights, power-ups and transformations, plot twists and emotional climaxes, ideally cut so the big hit lands on the beat. Skip dialogue-heavy exposition.",
    kind: "scenes",
    range: { min: 15, max: 30, label: "15–30s" },
    weights: { hook: 0.14, curiosity: 0.2, emotion: 0.3, value: 0.18, pacing: 0.18 },
    hooks: ["stakes", "interrupt", "curiosity", "payoff"],
    // Fast, cut-heavy action gets phonk; slower emotional builds get a cinematic swell.
    music: (s) => (s.pacing >= 55 || s.value >= 65 ? "phonk" : "cinematic"),
    musicVolume: 0.6,
    captions: false,
    captionStyle: "bold-pop",
    coldOpen: true,
    outro: "Follow for part 2",
  },
  {
    id: "gaming",
    label: "Gaming",
    emoji: "🎮",
    audience: "Gamers share clutch plays, unbelievable fails and big reactions. Start mid-action and land the payoff fast.",
    kind: "scenes",
    range: { min: 15, max: 30, label: "15–30s" },
    weights: { hook: 0.3, curiosity: 0.16, emotion: 0.3, value: 0.12, pacing: 0.12 },
    hooks: ["interrupt", "curiosity", "stakes", "payoff"],
    music: () => "trap",
    musicVolume: 0.5,
    captions: false,
    captionStyle: "bold-pop",
    coldOpen: true,
    outro: "Follow for more",
  },
  {
    id: "sports",
    label: "Sports",
    emoji: "⚽",
    audience: "Sports fans share the build-up to a big play and the moment itself: goals, saves, knockouts, crowd eruptions.",
    kind: "scenes",
    range: { min: 15, max: 30, label: "15–30s" },
    weights: { hook: 0.16, curiosity: 0.26, emotion: 0.32, value: 0.14, pacing: 0.12 },
    hooks: ["curiosity", "stakes", "payoff", "interrupt"],
    music: (s) => (s.emotion >= 85 ? "cinematic" : "trap"),
    musicVolume: 0.5,
    captions: false,
    captionStyle: "bold-pop",
    coldOpen: true,
    outro: "Follow for more highlights",
  },
  {
    id: "podcast",
    label: "Podcast & interview",
    emoji: "🎙️",
    audience: "Podcast clips win with a hot take, a contrarian opinion, an emotional personal story or practical advice, opening on the strongest line with no setup. One self-contained idea.",
    kind: "talking",
    range: { min: 15, max: 45, label: "15–45s" },
    weights: { hook: 0.36, curiosity: 0.2, emotion: 0.2, value: 0.16, pacing: 0.08 },
    hooks: ["curiosity", "stakes", "payoff", "interrupt"],
    music: () => "none",
    musicVolume: 0,
    captions: true,
    captionStyle: "bold-pop",
    coldOpen: false,
    outro: "Follow for more like this",
  },
  {
    id: "comedy",
    label: "Comedy & skits",
    emoji: "😂",
    audience: "Comedy works at 18-28 seconds: quick setup, a punchline that lands at the end, ideally with audible laughter. Never show the punchline first.",
    kind: "auto",
    range: { min: 18, max: 28, label: "18–28s" },
    weights: { hook: 0.2, curiosity: 0.3, emotion: 0.3, value: 0.08, pacing: 0.12 },
    hooks: ["curiosity", "payoff", "interrupt", "stakes"],
    music: () => "none",
    musicVolume: 0,
    captions: true,
    captionStyle: "clean",
    coldOpen: false,
    outro: "Follow for part 2",
  },
  {
    id: "motivation",
    label: "Sermon & motivation",
    emoji: "🔥",
    audience: "Motivational and sermon clips spread through one quotable, emotional line people want to send to someone, with room for it to land.",
    kind: "talking",
    range: { min: 30, max: 60, label: "30–60s" },
    weights: { hook: 0.26, curiosity: 0.14, emotion: 0.3, value: 0.22, pacing: 0.08 },
    hooks: ["stakes", "curiosity", "payoff", "interrupt"],
    music: () => "cinematic",
    musicVolume: 0.25,
    captions: true,
    captionStyle: "clean",
    coldOpen: false,
    outro: "Send this to someone who needs it",
  },
  {
    id: "vlog",
    label: "Vlog & story",
    emoji: "🎬",
    audience: "Story clips hold viewers with a turn: something unexpected, funny or relatable happens, and the ending pays it off.",
    kind: "auto",
    range: { min: 15, max: 45, label: "15–45s" },
    weights: { hook: 0.26, curiosity: 0.26, emotion: 0.22, value: 0.12, pacing: 0.14 },
    hooks: ["curiosity", "payoff", "stakes", "interrupt"],
    music: () => "lofi",
    musicVolume: 0.35,
    captions: true,
    captionStyle: "clean",
    coldOpen: true,
    outro: "Follow for part 2",
  },
];

export const playbook = (id: PlaybookId) => PLAYBOOKS.find((p) => p.id === id) ?? PLAYBOOKS[0];
