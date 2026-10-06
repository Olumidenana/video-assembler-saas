"use client";

import { useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon, SparkIcon } from "@/components/icons";
import type { MusicStyle } from "@/lib/audio/music";
import type { CaptionStyleId } from "@/lib/video/captions";
import type { PlanLimits } from "@/lib/plans";
import type { VideoKind } from "./viral-panel";

/** A ready-made recipe: what to look for and how to package it. */
export interface PackPreset {
  id: "edit" | "podcast" | "story";
  label: string;
  emoji: string;
  hint: string;
  kind: VideoKind;
  range: { min: number; max: number; label: string };
  captions: boolean;
  captionStyle: CaptionStyleId;
  music: MusicStyle | "none";
}

export const PACK_PRESETS: PackPreset[] = [
  {
    id: "edit",
    label: "Anime & gaming edit",
    emoji: "⚔️",
    hint: "Fights, reveals and hype moments, with a phonk drop on the peak",
    kind: "scenes",
    range: { min: 15, max: 30, label: "15–30s" },
    captions: false,
    captionStyle: "bold-pop",
    music: "phonk",
  },
  {
    id: "podcast",
    label: "Podcast & talking",
    emoji: "🎙️",
    hint: "The strongest takes, with word-by-word captions",
    kind: "talking",
    range: { min: 30, max: 60, label: "30–60s" },
    captions: true,
    captionStyle: "bold-pop",
    music: "none",
  },
  {
    id: "story",
    label: "Story, vlog & skit",
    emoji: "🎬",
    hint: "Moments that land, with captions and a soft lo-fi bed",
    kind: "auto",
    range: { min: 15, max: 45, label: "15–45s" },
    captions: true,
    captionStyle: "clean",
    music: "lofi",
  },
];

/**
 * The one-button workflow: find the best moments, (Studio) let AI Vision judge
 * and write them, then export finished vertical posts and a post kit.
 */
export function ClipPack({
  limits,
  busy,
  onMake,
}: {
  limits: PlanLimits;
  busy: boolean;
  onMake: (preset: PackPreset, count: number, vision: boolean) => void;
}) {
  const [preset, setPreset] = useState(PACK_PRESETS[0]);
  const [count, setCount] = useState(Math.min(3, limits.packClips));
  const [vision, setVision] = useState(limits.aiVision);
  const counts = [1, 3, 5, 8].filter((n) => n <= limits.packClips);

  return (
    <section
      id="tool-pack"
      className="relative scroll-mt-32 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-2/70 via-brand/40 to-transparent p-px"
      data-testid="clip-pack"
    >
      <div className="relative flex flex-col gap-5 rounded-2xl bg-surface p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-2/20 blur-3xl animate-drift" />
        <div className="relative flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-2 to-brand text-white shadow-lg shadow-brand-2/30">
            <SparkIcon size={18} />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Clip Pack</h2>
            <p className="text-sm text-muted">
              One click: the best moments become finished 9:16 posts with hook, captions, music and a post kit.
            </p>
          </div>
        </div>

        <div className="relative grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Pack style">
          {PACK_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset.id === p.id}
              onClick={() => setPreset(p)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left text-sm transition-colors ${
                preset.id === p.id ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong"
              }`}
            >
              <span className="font-medium">
                {p.emoji} {p.label}
              </span>
              <span className="text-xs text-muted">{p.hint}</span>
            </button>
          ))}
        </div>

        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted">Clips</span>
            <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Number of clips">
              {counts.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={count === n}
                  onClick={() => setCount(n)}
                  className={`rounded-md px-3 py-1 text-xs ${count === n ? "bg-brand text-white" : "text-muted hover:text-fg"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            {limits.packClips < 8 && (
              <HardLink href="/pricing" className="flex items-center gap-1 text-xs text-subtle hover:text-fg">
                <LockIcon size={11} /> up to 8 on Studio
              </HardLink>
            )}
          </div>

          {limits.aiVision ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} className="accent-brand" />
              <span>
                <span className="font-medium">AI Vision</span>{" "}
                <span className="text-muted">looks at the clips, picks the best and writes the hooks (10 AI credits)</span>
              </span>
            </label>
          ) : (
            <HardLink href="/pricing" className="flex items-center gap-1.5 text-muted hover:text-fg">
              <LockIcon size={12} /> AI Vision, which watches the clips and writes the hooks, is on Studio
            </HardLink>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary btn-lg relative self-start"
          disabled={busy}
          onClick={() => onMake(preset, count, vision && limits.aiVision)}
        >
          <SparkIcon size={16} /> Make my {count === 1 ? "clip" : `${count} clips`}
        </button>
      </div>
    </section>
  );
}
