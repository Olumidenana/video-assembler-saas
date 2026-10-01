/**
 * Clips for the landing page showcase. Drop matching 9:16 stock videos into
 * /public/showcase (a few seconds each, muted, H.264 MP4, ideally under 4 MB);
 * phones without a file show an animated scene in the clip's colours.
 */
export interface ShowcaseClip {
  /** e.g. "/showcase/podcast.mp4" (9:16, a few seconds, muted, <= 4 MB). */
  src: string;
  niche: string;
  caption: string;
  score: number;
  /** Two colours for the fallback scene. */
  tint: [string, string];
  signals: { hook: number; curiosity: number; emotion: number };
}

export const SHOWCASE: ShowcaseClip[] = [
  {
    src: "/showcase/skit.mp4",
    niche: "Skits & comedy",
    caption: "When mum says we have food at home",
    score: 88,
    tint: ["#ff7ac6", "#7563ff"],
    signals: { hook: 90, curiosity: 74, emotion: 96 },
  },
  {
    src: "/showcase/podcast.mp4",
    niche: "Podcast clipping",
    caption: "Nobody tells you this about saving money",
    score: 94,
    tint: ["#8b7bff", "#1fb67a"],
    signals: { hook: 97, curiosity: 92, emotion: 81 },
  },
  {
    src: "/showcase/faceless.mp4",
    niche: "YouTube automation",
    caption: "3 places you won't believe really exist",
    score: 86,
    tint: ["#5cc8ff", "#e79a0c"],
    signals: { hook: 88, curiosity: 95, emotion: 70 },
  },
];
