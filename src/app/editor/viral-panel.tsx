"use client";

import { useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon, SparkIcon } from "@/components/icons";
import type { ViralClip, ViralScores } from "@/lib/assistant/viral";
import type { SpeechOptions } from "@/lib/video/transcribe";
import { ClipPreview } from "./clip-preview";
import { SpeechControls } from "./export-settings";
import { formatTime } from "./format";

export type ViralRange = { min: number; max: number; label: string };

export const VIRAL_RANGES: ViralRange[] = [
  { min: 15, max: 30, label: "15–30s · Status & Shorts" },
  { min: 30, max: 60, label: "30–60s · Reels & TikTok" },
  { min: 60, max: 90, label: "60–90s · YouTube & long Reels" },
];

/** "talking": podcasts, vlogs, sermons (scored on the words); "scenes": anime, films, gaming, skits (scored on the edit). */
export type VideoKind = "auto" | "talking" | "scenes";

const KINDS: { id: VideoKind; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "Decide from how the video is edited" },
  { id: "talking", label: "Talking", title: "Podcasts, interviews, vlogs, sermons: scored on what's said" },
  { id: "scenes", label: "Scenes", title: "Anime, films, gaming, sports, skits: scored on the action and story arc" },
];

const SIGNALS: Record<"transcript" | "scenes", { key: keyof ViralScores; label: string }[]> = {
  transcript: [
    { key: "hook", label: "Hook" },
    { key: "curiosity", label: "Curiosity" },
    { key: "emotion", label: "Emotion" },
    { key: "value", label: "Value" },
    { key: "pacing", label: "Pacing" },
  ],
  scenes: [
    { key: "hook", label: "Hook" },
    { key: "curiosity", label: "Build-up" },
    { key: "emotion", label: "Peak" },
    { key: "value", label: "Intensity" },
    { key: "pacing", label: "Pacing" },
  ],
};

interface Props {
  clips: ViralClip[] | null;
  /** "transcript" = scored on words + sound; "scenes" = scored on the edit, sound and action. */
  basis: "transcript" | "scenes" | null;
  busy: boolean;
  exportable: number;
  canImprove: boolean;
  improved: boolean;
  clipName: (clipId: string) => string;
  /** The source video's blob URL, for live previews. */
  clipUrl: (clipId: string) => string | undefined;
  speech: SpeechOptions;
  onSpeech: (s: SpeechOptions) => void;
  onFind: (range: ViralRange, kind: VideoKind) => void;
  onImprove: () => void;
  onUse: (clip: ViralClip) => void;
  onExport: (clips: ViralClip[]) => void;
}

export function ViralPanel(props: Props) {
  const { clips, busy, exportable } = props;
  const [range, setRange] = useState(VIRAL_RANGES[0]);
  const [kind, setKind] = useState<VideoKind>("auto");
  const unlocked = clips?.slice(0, exportable) ?? [];

  return (
    <section className="card relative flex flex-col gap-5 overflow-hidden p-5 sm:p-6" data-testid="viral-panel">
      <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-brand-2/15 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-2 to-brand text-white shadow-lg shadow-brand-2/30">
            <span className="text-lg">🔥</span>
          </span>
          <div>
            <h2 className="text-lg font-semibold">Viral Clip Finder</h2>
            <p className="text-sm text-muted">Turns long videos into short clips, scored on hook, curiosity, emotion, value and pacing.</p>
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Video type">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              title={k.title}
              onClick={() => setKind(k.id)}
              className={`rounded-md px-3 py-1 text-xs transition-colors sm:text-sm ${kind === k.id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Clip length">
          {VIRAL_RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="radio"
              aria-checked={range === r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-xs transition-colors sm:text-sm ${range === r ? "bg-brand text-white" : "text-muted hover:text-fg"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => props.onFind(range, kind)}>
          {clips ? "Find again" : "Find viral clips"}
        </button>
        {clips && clips.length > 0 && props.canImprove && !props.improved && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={props.onImprove}>
            <SparkIcon size={14} /> Improve with AI
          </button>
        )}
      </div>

      {kind === "talking" && (
        <div className="relative">
          <SpeechControls speech={props.speech} onChange={props.onSpeech} />
        </div>
      )}

      {clips && clips.length === 0 && (
        <p className="notice notice-info relative">
          No clips found in that length range. Try a shorter range, or add a longer video with someone talking.
        </p>
      )}

      {clips && clips.length > 0 && (
        <>
          <p className="relative text-xs text-subtle">
            {props.improved
              ? "Picked and written by AI using content psychology."
              : props.basis === "scenes"
                ? "Scored on scenes: the opening, build-up, peak, intensity and pace of the edit. Theme songs are skipped."
                : "Scored on the words spoken plus sound and action."}{" "}
            Scores are a guide, not a promise. Your audience decides.
          </p>
          <ol className="relative grid gap-3 md:grid-cols-2" data-testid="viral-clips">
            {clips.map((clip, i) => (
              <ClipCard key={clip.id} clip={clip} signals={SIGNALS[props.basis ?? "transcript"]} rank={i + 1} locked={i >= exportable} busy={busy} name={props.clipName(clip.clipId)} url={props.clipUrl(clip.clipId)} onUse={props.onUse} onExport={(c) => props.onExport([c])} />
            ))}
          </ol>
          {unlocked.length > 1 && (
            <button type="button" className="btn btn-primary relative self-start" disabled={busy} onClick={() => props.onExport(unlocked)}>
              Export {unlocked.length} clips
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? "#3ddc97" : score >= 55 ? "#fbbf24" : "#ff7ac6";
  return (
    <span
      className="grid size-14 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(${color} ${score * 3.6}deg, rgb(255 255 255 / 0.08) 0deg)` }}
      aria-label={`Viral score ${score} out of 100`}
    >
      <span className="grid size-11 place-items-center rounded-full bg-surface font-mono text-base font-semibold">{score}</span>
    </span>
  );
}

function ClipCard({
  clip,
  signals,
  rank,
  locked,
  busy,
  name,
  url,
  onUse,
  onExport,
}: {
  clip: ViralClip;
  signals: { key: keyof ViralScores; label: string }[];
  rank: number;
  locked: boolean;
  busy: boolean;
  name: string;
  url: string | undefined;
  onUse: (c: ViralClip) => void;
  onExport: (c: ViralClip) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-line bg-surface-2/60 p-4" data-locked={locked || undefined}>
      <div className={`flex flex-col gap-3 ${locked ? "pointer-events-none select-none blur-[3px]" : ""}`} aria-hidden={locked}>
        {url && <ClipPreview url={url} start={clip.start} end={clip.end} poster={clip.peak ?? clip.start + Math.min(2, (clip.end - clip.start) / 3)} />}
        <div className="flex items-start gap-3">
          <ScoreRing score={clip.score} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-subtle">
              #{rank} · {formatTime(clip.end - clip.start)} · {name} @ {formatTime(clip.start)}
            </p>
            <p className="font-medium leading-snug">{clip.title}</p>
          </div>
        </div>
        <p className="border-l-2 border-brand/50 pl-3 text-sm italic text-muted">“{clip.hook}”</p>
        <div className="grid grid-cols-5 gap-1.5">
          {signals.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${clip.scores[s.key]}%` }} />
              </div>
              <span className="text-[10px] text-subtle">{s.label}</span>
            </div>
          ))}
        </div>
        {clip.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {clip.reasons.map((r) => (
              <span key={r} className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-[#c4bbff]">
                {r}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          {clip.caption} <span className="text-brand">{clip.hashtags.join(" ")}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || locked} onClick={() => onExport(clip)}>
            Export
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || locked} onClick={() => onUse(clip)}>
            Edit on timeline
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={locked}
            onClick={() => {
              void navigator.clipboard?.writeText(`${clip.title}\n\n${clip.caption}\n\n${clip.hashtags.join(" ")}`).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied!" : "Copy caption"}
          </button>
        </div>
      </div>
      {locked && (
        <div className="absolute inset-0 grid place-items-center bg-bg/40 p-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <LockIcon size={14} /> Viral score {clip.score}
            </span>
            <HardLink href="/pricing" className="btn btn-primary btn-sm">
              Unlock with Studio
            </HardLink>
          </div>
        </div>
      )}
    </li>
  );
}
