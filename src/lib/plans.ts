export type PlanId = "free" | "pro";

export interface PlanLimits {
  label: string;
  /**
   * Max different source videos in one stitched export. Counts videos, not
   * cuts, so auto-edit can make as many cuts from a video as it likes.
   */
  maxStitchClips: number;
  /** Exports are scaled so the shorter side is at most this many pixels (720 = "720p"). */
  maxShortSide: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { label: "Free", maxStitchClips: 3, maxShortSide: 720 },
  pro: { label: "Pro", maxStitchClips: Infinity, maxShortSide: Infinity },
};
