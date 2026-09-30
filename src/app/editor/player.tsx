"use client";

import { useEffect, useRef, useState } from "react";
import { ScissorsIcon, SplitIcon } from "@/components/icons";
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

  return (
    <div className="card flex flex-col gap-4 p-3 sm:p-4">
      <video
        ref={ref}
        src={clip.url}
        controls
        playsInline
        className="aspect-video w-full rounded-xl bg-black"
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
        <p className="notice notice-warn" data-testid="preview-failed">
          Your browser can&apos;t preview this format (common with iPhone HEVC or MKV files), but it can still be
          exported. Type the start and end times in the segment list instead.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-sm text-muted">
          <span className="font-mono text-fg">{formatTime(time)}</span>
          <span className="mx-2 text-subtle">·</span>
          segment <span className="font-mono">{formatTime(segment.start)}</span> –{" "}
          <span className="font-mono">{formatTime(segment.end)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSetStart(time)}>
            Set start here
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSetEnd(time)}>
            Set end here
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!canSplit} onClick={() => onSplit(time)}>
            <ScissorsIcon size={15} /> Split here
          </button>
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2 border-t border-line px-1 pt-4 text-sm text-muted"
        onSubmit={(e) => {
          e.preventDefault();
          if (partSeconds > 0) onSplitEvery(partSeconds);
        }}
      >
        <SplitIcon size={16} className="text-subtle" />
        <label htmlFor="part-seconds">Split into parts of</label>
        <input
          id="part-seconds"
          type="number"
          min={1}
          step={1}
          value={partSeconds}
          onChange={(e) => setPartSeconds(Number(e.target.value))}
          className="input w-20 font-mono"
        />
        <span>seconds</span>
        <button type="submit" className="btn btn-secondary btn-sm">
          Split
        </button>
        <span className="text-xs text-subtle">Tip: 30s fits WhatsApp Status, 60s fits Reels and Shorts.</span>
      </form>
    </div>
  );
}
