export type PlanId = "free" | "pro" | "studio";
export type PaidPlanId = Exclude<PlanId, "free">;

export interface PlanLimits {
  label: string;
  /**
   * Max different source videos in one stitched export. Counts videos, not
   * cuts, so auto-edit can make as many cuts from a video as it likes.
   */
  maxStitchClips: number;
  /** Exports are scaled so the shorter side is at most this many pixels (720 = "720p"). */
  maxShortSide: number;
  /** Small "Made with Anti-Timeout" mark on exports (free marketing on every post). */
  watermark: boolean;
  /** How much of an export can carry burned-in captions, in seconds. */
  captionSeconds: number;
  /** Caption looks available. */
  captionStyles: "basic" | "all";
  /** Viral clips that can be exported per analysis; the rest are shown but locked. */
  viralClipExports: number;
  /** Creator's own logo overlaid on exports. */
  brandLogo: boolean;
  /** AI (Claude) requests per day. Auto-edit and local commands don't count. */
  aiDailyLimit: number;
  /** Finished clips per Clip Pack (one click: find, package, export). */
  packClips: number;
  /** AI Vision: Claude looks at frames to judge and write the clips (and, in Mashup, match them by theme). */
  aiVision: boolean;
  /** Videos one mashup can cut between. */
  mashupVideos: number;
}

/**
 * Free is deliberately generous enough to feel the magic (captions on short
 * clips, the top viral clip, 9:16 reframing) but always watermarked; Pro
 * unlocks the editor; Studio is the repurposing machine for creators.
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    label: "Free",
    maxStitchClips: 3,
    maxShortSide: 720,
    watermark: true,
    captionSeconds: 60,
    captionStyles: "basic",
    viralClipExports: 1,
    brandLogo: false,
    aiDailyLimit: 5,
    packClips: 1,
    aiVision: false,
    mashupVideos: 2,
  },
  pro: {
    label: "Pro",
    maxStitchClips: Infinity,
    maxShortSide: Infinity,
    watermark: false,
    captionSeconds: Infinity,
    captionStyles: "basic",
    viralClipExports: 3,
    brandLogo: false,
    aiDailyLimit: 40,
    packClips: 3,
    aiVision: false,
    mashupVideos: 5,
  },
  studio: {
    label: "Studio",
    maxStitchClips: Infinity,
    maxShortSide: Infinity,
    watermark: false,
    captionSeconds: Infinity,
    captionStyles: "all",
    viralClipExports: Infinity,
    brandLogo: true,
    aiDailyLimit: 80,
    packClips: 8,
    aiVision: true,
    mashupVideos: 12,
  },
};

export const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, studio: 2 };
export const PAID_PLANS: PaidPlanId[] = ["pro", "studio"];
