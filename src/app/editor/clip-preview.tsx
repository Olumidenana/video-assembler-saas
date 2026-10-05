"use client";

import { useEffect, useRef, useState } from "react";
import { useThumbnail } from "./thumbnails";

/**
 * A live preview of one clip inside the user's video: shows the frame at the
 * peak, plays the clip (muted, looping between start and end) while hovered
 * on desktop or on screen on phones. Click for sound.
 */
export function ClipPreview({
  url,
  start,
  end,
  poster,
  className = "",
}: {
  url: string;
  start: number;
  end: number;
  /** Time of the still shown before playing. */
  poster: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const still = useThumbnail(url, poster, 480);
  const [active, setActive] = useState(false);
  const [sound, setSound] = useState(false);
  const [failed, setFailed] = useState(false);

  // Phones have no hover: play while the card is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia("(hover: none)").matches) return;
    const io = new IntersectionObserver(([e]) => setActive(e.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active || sound) {
      if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [active, sound, start, end]);

  return (
    <div
      ref={ref}
      className={`group relative aspect-video overflow-hidden rounded-lg bg-black ${className}`}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      {still && (
        // eslint-disable-next-line @next/next/no-img-element -- a frame from the user's own local video
        <img src={still} alt="" className="absolute inset-0 size-full object-contain" />
      )}
      {!failed && (
        <video
          ref={video}
          src={url}
          muted={!sound}
          playsInline
          preload="none"
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= end) e.currentTarget.currentTime = start;
          }}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-full object-contain transition-opacity duration-300 ${active || sound ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {!failed && (
        <button
          type="button"
          onClick={() => setSound((s) => !s)}
          className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white opacity-90 backdrop-blur transition-opacity hover:opacity-100"
          aria-label={sound ? "Mute preview" : "Play preview with sound"}
        >
          {sound ? "🔊 Sound on" : active ? "🔇 Tap for sound" : "▶ Preview"}
        </button>
      )}
      {!still && !active && (
        <div className="absolute inset-0 grid place-items-center text-xs text-subtle">{failed ? "Preview not available for this format" : "Loading preview…"}</div>
      )}
    </div>
  );
}
