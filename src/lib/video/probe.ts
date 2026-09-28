import type { MediaInfo } from "./types";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string };
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

function parseRotation(stream: ProbeStream): number {
  const fromSideData = stream.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation;
  const raw = Math.round(fromSideData ?? Number(stream.tags?.rotate ?? 0)) || 0;
  return ((raw % 360) + 360) % 360;
}

/** Converts `ffprobe -print_format json -show_format -show_streams` output to MediaInfo. */
export function parseProbe(json: string): MediaInfo {
  const data = JSON.parse(json) as ProbeOutput;
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video || !video.width || !video.height) {
    throw new Error("No video stream found. Is this a video file?");
  }
  const audio = data.streams?.find((s) => s.codec_type === "audio");

  const duration = Number(data.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Couldn't read the video's duration.");
  }

  const rotation = parseRotation(video);
  const swap = rotation % 180 === 90;
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;

  return {
    duration,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    fps,
    rotation,
    videoCodec: video.codec_name ?? "unknown",
    videoProfile: video.profile ?? null,
    pixFmt: video.pix_fmt ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    audioChannels: audio?.channels ?? null,
  };
}
