"use client";

import { useEffect, useRef, useState } from "react";
import type { ShowcaseClip } from "./showcase-data";

/**
 * Phone mock-ups showing what the Viral Clip Finder produces: a vertical clip
 * with word-by-word captions and its viral score. Each phone plays a stock
 * video from /public/showcase when the file exists; until then (or while it
 * loads) an animated scene in the clip's colours shows instead.
 */
const WORD_MS = 420;
const GROUP = 3;

export function ShowcasePhone({
  clip,
  hasVideo,
  className = "",
  priority = false,
}: {
  clip: ShowcaseClip;
  /** Whether clip.src exists (listed at build time, so missing files don't 404). */
  hasVideo: boolean;
  className?: string;
  priority?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [word, setWord] = useState(0);
  const words = clip.caption.split(" ");

  // Only animate and play while on screen (battery on phones), and never with reduced motion.
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (visible) v.play().catch(() => {});
    else v.pause();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    // A pause on the last word before the caption starts again.
    const id = setInterval(() => setWord((w) => (w + 1) % (words.length + 3)), WORD_MS);
    return () => clearInterval(id);
  }, [visible, words.length]);

  const active = Math.min(word, words.length - 1);
  const groupStart = Math.floor(active / GROUP) * GROUP;
  const group = words.slice(groupStart, groupStart + GROUP);

  return (
    <div ref={ref} className={`relative aspect-[9/16] w-full overflow-hidden @container rounded-[2rem] border-[5px] border-[#1d1d24] bg-black shadow-2xl ${className}`}>
      {/* Fallback scene, always underneath the video. */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${clip.tint[0]}55, #0a0a0d 55%, ${clip.tint[1]}55)` }}>
        <div className="absolute -left-1/4 top-1/4 size-3/4 rounded-full blur-3xl animate-drift" style={{ background: `${clip.tint[0]}66` }} />
        <div className="absolute -right-1/4 bottom-1/4 size-3/4 rounded-full blur-3xl animate-drift-slow" style={{ background: `${clip.tint[1]}55` }} />
      </div>
      {hasVideo && (
        <video
          ref={video}
          src={clip.src}
          muted
          loop
          playsInline
          preload={priority ? "auto" : "metadata"}
          onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${playing ? "opacity-100" : "opacity-0"}`}
        />
      )}
      <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />

      <div className="absolute inset-x-3 top-3 flex items-center justify-between">
        <span className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-medium text-white/90 backdrop-blur">{clip.niche}</span>
        <span className="flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[10px] text-white/90 backdrop-blur">
          <span className="size-1.5 rounded-full bg-[#ff4d6d]" /> 0:{String(14 + words.length * 3).padStart(2, "0")}
        </span>
      </div>

      {/* Word-by-word captions, in the export's Bold Pop style. */}
      <p className="absolute inset-x-3 top-[58%] text-center font-display text-[clamp(1rem,10cqw,2rem)] uppercase leading-tight tracking-wide text-white [text-shadow:0_2px_0_#000,0_0_12px_rgb(0_0_0/0.7)]">
        {group.map((w, i) => {
          const isActive = visible && groupStart + i === active;
          return (
            <span key={`${groupStart}-${i}`} className={`inline-block px-[0.12em] ${isActive ? "animate-pop text-[#ffe14d]" : ""}`}>
              {w}
            </span>
          );
        })}
      </p>

      <div className="absolute inset-x-3 bottom-3 flex items-center gap-2.5 rounded-2xl bg-black/50 p-2 backdrop-blur-md">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(#3ddc97 ${clip.score * 3.6}deg, rgb(255 255 255 / 0.12) 0deg)` }}
          aria-label={`Viral score ${clip.score}`}
        >
          <span className="grid size-8 place-items-center rounded-full bg-[#111] font-mono text-xs font-semibold text-white">{clip.score}</span>
        </span>
        <div className="grid flex-1 gap-1">
          {(["hook", "curiosity", "emotion"] as const).map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="w-12 text-[9px] capitalize text-white/70">{k}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
                <span className="block h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${clip.signals[k]}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
