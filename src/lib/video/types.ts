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
}
