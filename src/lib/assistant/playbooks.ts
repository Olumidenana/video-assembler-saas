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
import nichesData from "./knowledge/niches.json";

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

const n = nichesData.niches;

export const PLAYBOOKS: Playbook[] = [
  {
    id: "anime",
    label: n.anime.label,
    emoji: n.anime.emoji,
    audience: n.anime.audience,
    kind: "scenes",
    range: { min: n.anime.range.min, max: n.anime.range.max, label: n.anime.range.label },
    weights: n.anime.weights,
    hooks: ["stakes", "interrupt", "curiosity", "payoff"],
    // Fast, cut-heavy action gets phonk; slower emotional builds get a cinematic swell.
    music: (s) => (s.pacing >= 55 || s.value >= 65 ? "phonk" : "cinematic"),
    musicVolume: 0.6,
    captions: false,
    captionStyle: "bold-pop",
    coldOpen: n.anime.coldOpen,
    outro: "Follow for part 2",
  },
  {
    id: "gaming",
    label: n.gaming.label,
    emoji: n.gaming.emoji,
    audience: n.gaming.audience,
    kind: "scenes",
    range: { min: n.gaming.range.min, max: n.gaming.range.max, label: n.gaming.range.label },
    weights: n.gaming.weights,
    hooks: ["interrupt", "curiosity", "stakes", "payoff"],
    music: () => "trap",
    musicVolume: 0.5,
    captions: false,
    captionStyle: "bold-pop",
    coldOpen: n.gaming.coldOpen,
    outro: "Follow for more",
  },
  {
    id: "sports",
    label: n.sports.label,
    emoji: n.sports.emoji,
    audience: n.sports.audience,
    kind: "scenes",
    range: { min: n.sports.range.min, max: n.sports.range.max, label: n.sports.range.label },
    weights: n.sports.weights,
    hooks: ["curiosity", "stakes", "payoff", "interrupt"],
    music: (s) => (s.emotion >= 85 ? "cinematic" : "trap"),
    musicVolume: 0.5,
    captions: false,
    captionStyle: "bold-pop",
    coldOpen: n.sports.coldOpen,
    outro: "Follow for more highlights",
  },
  {
    id: "podcast",
    label: n.podcast.label,
    emoji: n.podcast.emoji,
    audience: n.podcast.audience,
    kind: "talking",
    range: { min: n.podcast.range.min, max: n.podcast.range.max, label: n.podcast.range.label },
    weights: n.podcast.weights,
    hooks: ["curiosity", "stakes", "payoff", "interrupt"],
    music: () => "none",
    musicVolume: 0,
    captions: true,
    captionStyle: "bold-pop",
    coldOpen: n.podcast.coldOpen,
    outro: "Follow for more like this",
  },
  {
    id: "comedy",
    label: n.comedy.label,
    emoji: n.comedy.emoji,
    audience: n.comedy.audience,
    kind: "auto",
    range: { min: n.comedy.range.min, max: n.comedy.range.max, label: n.comedy.range.label },
    weights: n.comedy.weights,
    hooks: ["curiosity", "payoff", "interrupt", "stakes"],
    music: () => "none",
    musicVolume: 0,
    captions: true,
    captionStyle: "clean",
    coldOpen: n.comedy.coldOpen,
    outro: "Follow for part 2",
  },
  {
    id: "motivation",
    label: n.motivation.label,
    emoji: n.motivation.emoji,
    audience: n.motivation.audience,
    kind: "talking",
    range: { min: n.motivation.range.min, max: n.motivation.range.max, label: n.motivation.range.label },
    weights: n.motivation.weights,
    hooks: ["stakes", "curiosity", "payoff", "interrupt"],
    music: () => "cinematic",
    musicVolume: 0.25,
    captions: true,
    captionStyle: "clean",
    coldOpen: n.motivation.coldOpen,
    outro: n.motivation.cta,
  },
  {
    id: "vlog",
    label: n.vlog.label,
    emoji: n.vlog.emoji,
    audience: n.vlog.audience,
    kind: "auto",
    range: { min: n.vlog.range.min, max: n.vlog.range.max, label: n.vlog.range.label },
    weights: n.vlog.weights,
    hooks: ["curiosity", "payoff", "stakes", "interrupt"],
    music: () => "lofi",
    musicVolume: 0.35,
    captions: true,
    captionStyle: "clean",
    coldOpen: n.vlog.coldOpen,
    outro: n.vlog.cta,
  },
];

export const playbook = (id: PlaybookId) => PLAYBOOKS.find((p) => p.id === id) ?? PLAYBOOKS[0];

