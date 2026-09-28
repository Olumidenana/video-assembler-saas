"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_SEGMENT_SECONDS } from "@/lib/video/commands";
import type { Clip, Segment } from "@/lib/video/types";
import { formatTime } from "./format";

interface PlayerProps {
  clip: Clip;
  segment: Segment;
  onSetStart: (t: number) => void;
  onSetEnd: (t: number) => void;
  onSplit: (t: number) => void;
  onSplitEvery: (seconds: number) => void;
}

/** Previews the selected segment and sets trim/split points from the playhead. */
export function Player({ clip, segment, onSetStart, onSetEnd, onSplit, onSplitEvery }: PlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(segment.start);
  const [partSeconds, setPartSeconds] = useState(30);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Jump to the segment's start when it's selected or its start moves.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      video.currentTime = segment.start;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [segment.id, segment.start, clip.url]);

  const canSplit = time - segment.start >= MIN_SEGMENT_SECONDS && segment.end - time >= MIN_SEGMENT_SECONDS;
  const button = "rounded-md border border-foreground/20 px-3 py-1.5 text-sm disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={ref}
        src={clip.url}
        controls
        playsInline
        className="aspect-video w-full rounded-lg bg-black"
        onError={() => setPreviewFailed(true)}
        onTimeUpdate={(e) => {
          const video = e.currentTarget;
          setTime(video.currentTime);
          // Stop at the segment's end so the preview matches the export.
          if (!video.paused && video.currentTime >= segment.end) {
            video.pause();
            video.currentTime = segment.end;
          }
        }}
        onPlay={(e) => {
          const video = e.currentTarget;
          if (video.currentTime < segment.start - 0.05 || video.currentTime >= segment.end - 0.05) {
            video.currentTime = segment.start;
          }
        }}
      />

      {previewFailed && (
        <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400" data-testid="preview-failed">
          Your browser can&apos;t preview this format (common with iPhone HEVC or MKV files), but it can still be
          exported. Type the start and end times in the segment list instead.
        </p>
      )}

      <p className="text-sm text-foreground/70">
        Playhead <span className="font-mono">{formatTime(time)}</span> · Segment{" "}
        <span className="font-mono">
          {formatTime(segment.start)}–{formatTime(segment.end)}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => onSetStart(time)}>
          Set start here
        </button>
        <button type="button" className={button} onClick={() => onSetEnd(time)}>
          Set end here
        </button>
        <button type="button" className={button} disabled={!canSplit} onClick={() => onSplit(time)}>
          Split here
        </button>
      </div>

      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (partSeconds > 0) onSplitEvery(partSeconds);
        }}
      >
        <label htmlFor="part-seconds">Split into parts of</label>
        <input
          id="part-seconds"
          type="number"
          min={1}
          step={1}
          value={partSeconds}
          onChange={(e) => setPartSeconds(Number(e.target.value))}
          className="w-20 rounded-md border border-foreground/20 bg-transparent px-2 py-1"
        />
        <span>seconds</span>
        <button type="submit" className={button}>
          Split
        </button>
      </form>
    </div>
  );
}
