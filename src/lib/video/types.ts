import type { Transition } from "./transitions";

export interface MediaInfo {
  /** Seconds. */
  duration: number;
  /** Display size, i.e. after applying rotation metadata. */
  width: number;
  height: number;
  fps: number;
  /** Rotation metadata in degrees, normalized to 0..359 (0 = none). */
  rotation: number;
  videoCodec: string;
  videoProfile: string | null;
  pixFmt: string | null;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
}

/** A source file the user added. */
export interface Clip {
  id: string;
  file: File;
  info: MediaInfo;
  /** Object URL for previewing in a <video> element. */
  url: string;
}

/** A time range of a clip. The timeline is an ordered list of these. */
export interface Segment {
  id: string;
  clipId: string;
  start: number;
  end: number;
}

/** A segment paired with its clip's metadata, as needed to build commands. */
export interface ExportItem {
  clipId: string;
  info: MediaInfo;
  start: number;
  end: number;
  /** Cut in from a white flash (after a flash-forward intro). */
  flashIn?: boolean;
  /** Blend in from the previous item (overlaps it; see transitions.ts). */
  transitionIn?: Transition;
  /** Playback speed: 0.5 = half-speed slow motion (plays twice as long as the source range). */
  speed?: number;
  /** Beat-edit effects at the start of the segment, on the cut. */
  fx?: SegmentFx;
  /** "Follow the speaker": where the crop is centered over time (segment seconds, 0..1 of the width). */
  track?: { t: number; x: number }[];
}

export interface SegmentFx {
  /** Fade in from white over this many seconds (a flash on the beat). */
  flash?: number;
  /** Fade in from black over this many seconds (a soft dip, for emotional cuts). */
  dip?: number;
  /** Zoom punch: starts zoomed in and snaps back over the first quarter second. */
  punch?: boolean;
  /** Camera shake that settles over the first third of a second (an impact). */
  shake?: boolean;
  /** Hold a punch-in for the whole segment (1.2 = 20% closer, framed on the upper middle where faces are). */
  zoom?: number;
}
