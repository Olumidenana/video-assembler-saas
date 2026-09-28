export type PlanId = "free" | "pro";

export interface PlanLimits {
  label: string;
  /** Max segments that can be stitched into one video. */
  maxStitchSegments: number;
  /** Exports are scaled so the shorter side is at most this many pixels (720 = "720p"). */
  maxShortSide: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { label: "Free", maxStitchSegments: 3, maxShortSide: 720 },
  pro: { label: "Pro", maxStitchSegments: Infinity, maxShortSide: Infinity },
};
