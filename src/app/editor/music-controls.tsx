"use client";

import { useEffect, useRef, useState } from "react";
import { MUSIC_STYLES, type MusicStyle, planTrack, renderTrack } from "@/lib/audio/music";

export interface MusicSettings {
  /** A composed style, the user's own track, or no music. */
  style: MusicStyle | "own" | "none";
  /** 0..1 */
  volume: number;
  /** Original sound level, 0..1. */
  original: number;
  /** Lower the music while people talk. */
  duck: boolean;
}

export const DEFAULT_MUSIC: MusicSettings = { style: "none", volume: 0.6, original: 1, duck: true };

export interface OwnTrack {
  name: string;
  bytes: Uint8Array;
  ext: string;
}

const PREVIEW_SECONDS = 12;
const PREVIEW_DROP = 5;

/**
 * Music for exports: an original beat composed for each clip (its drop lands
 * on the clip's biggest moment), or the user's own track.
 */
export function MusicControls({
  music,
  onChange,
  ownTrack,
  onOwnTrack,
}: {
  music: MusicSettings;
  onChange: (m: MusicSettings) => void;
  ownTrack: OwnTrack | null;
  onOwnTrack: (file: File | null) => void;
}) {
  const set = (patch: Partial<MusicSettings>) => onChange({ ...music, ...patch });
  const audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const [playing, setPlaying] = useState<MusicStyle | null>(null);
  const [loading, setLoading] = useState<MusicStyle | null>(null);

  const stop = () => {
    audio.current?.src.stop();
    void audio.current?.ctx.close();
    audio.current = null;
    setPlaying(null);
  };
  useEffect(() => () => stop(), []);

  async function preview(style: MusicStyle) {
    if (playing === style) return stop();
    stop();
    setLoading(style);
    try {
      const buffer = await renderTrack(planTrack(style, PREVIEW_SECONDS, PREVIEW_DROP, 3));
      const ctx = new AudioContext();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = music.volume;
      src.connect(gain).connect(ctx.destination);
      src.onended = () => {
        if (audio.current?.src === src) stop();
      };
      src.start();
      audio.current = { ctx, src };
      setPlaying(style);
    } finally {
      setLoading(null);
    }
  }

  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition-colors ${active ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong"}`;

  return (
    <div className="flex flex-col gap-3" data-testid="music-controls">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">Music</span>
        <span className="text-xs text-muted">Original beats made for each clip. The drop hits on its biggest moment.</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <button type="button" className={chip(music.style === "none")} onClick={() => set({ style: "none" })} aria-pressed={music.style === "none"}>
          <span className="block font-medium">No music</span>
          <span className="block text-xs text-muted">Original sound only</span>
        </button>
        {MUSIC_STYLES.map((s) => (
          <div key={s.id} className={`${chip(music.style === s.id)} relative`}>
            <button type="button" className="block w-full pr-8 text-left" onClick={() => set({ style: s.id })} aria-pressed={music.style === s.id}>
              <span className="block font-medium">{s.label}</span>
              <span className="block text-xs text-muted">{s.hint}</span>
            </button>
            <button
              type="button"
              onClick={() => void preview(s.id)}
              className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-surface-3 text-xs hover:bg-brand hover:text-white"
              aria-label={playing === s.id ? `Stop ${s.label} preview` : `Preview ${s.label}`}
            >
              {loading === s.id ? "…" : playing === s.id ? "■" : "▶"}
            </button>
          </div>
        ))}
        <label className={`${chip(music.style === "own")} cursor-pointer`}>
          <span className="block font-medium">Your own track</span>
          <span className="block truncate text-xs text-muted">{ownTrack ? ownTrack.name : "MP3, WAV or M4A you have the rights to"}</span>
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0] ?? null;
              onOwnTrack(file);
              if (file) set({ style: "own" });
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      {music.style !== "none" && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
          <label className="flex items-center gap-2">
            Music level
            <input type="range" min={0.1} max={1} step={0.05} value={music.volume} onChange={(e) => set({ volume: Number(e.target.value) })} className="accent-brand" />
          </label>
          <label className="flex items-center gap-2">
            Original sound
            <input type="range" min={0} max={1} step={0.05} value={music.original} onChange={(e) => set({ original: Number(e.target.value) })} className="accent-brand" />
            <span className="w-9 font-mono text-xs">{Math.round(music.original * 100)}%</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={music.duck} onChange={(e) => set({ duck: e.target.checked })} className="accent-brand" />
            Lower music when people talk
          </label>
        </div>
      )}
      {music.style === "own" && (
        <p className="text-xs text-subtle">
          Only use music you have the rights to. For trending sounds, add them inside TikTok or Instagram after uploading, where they&apos;re licensed.
        </p>
      )}
    </div>
  );
}
