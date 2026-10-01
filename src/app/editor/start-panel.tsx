"use client";

import { useState } from "react";
import { UploadIcon } from "@/components/icons";

/** What the user wants to make; the editor runs it as soon as their video is read. */
export type Goal = "viral" | "highlight" | "captions" | "stitch";

const GOALS: { id: Goal; emoji: string; title: string; body: string; tag?: string }[] = [
  {
    id: "viral",
    emoji: "🔥",
    title: "Find viral clips",
    body: "Drop a podcast, stream, sermon or vlog. Get short clips ranked by viral score.",
    tag: "Most popular",
  },
  { id: "highlight", emoji: "✨", title: "Make a highlight", body: "AI keeps the loudest, most active 30 seconds and cuts the rest." },
  { id: "captions", emoji: "💬", title: "Add captions", body: "Word-by-word captions on a vertical 9:16 video, ready for Reels." },
  { id: "stitch", emoji: "🔗", title: "Join or split videos", body: "Stitch clips into one MP4, or chop a long one into Status parts." },
];

/** The editor before any video is added: a big drop zone plus one-click goals. */
export function StartPanel({ onPick, onDrop }: { onPick: (goal: Goal | null) => void; onDrop: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex flex-col gap-6" data-testid="start-panel">
      <button
        type="button"
        onClick={() => onPick(null)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onDrop([...e.dataTransfer.files]);
        }}
        className={`group relative flex flex-col items-center gap-5 overflow-hidden rounded-3xl border px-6 py-14 text-center transition-colors sm:py-20 ${
          dragging ? "border-brand bg-brand/10" : "border-line-strong bg-surface/70 hover:border-brand/60"
        }`}
      >
        <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-brand/25 blur-3xl animate-drift" />
        <div className="pointer-events-none absolute -bottom-28 -right-20 size-80 rounded-full bg-brand-2/20 blur-3xl animate-drift-slow" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.03)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.03)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(closest-side,black,transparent)]" />

        <span className="relative grid size-20 place-items-center rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-2xl shadow-brand/40 animate-float">
          <UploadIcon size={34} />
        </span>
        <span className="relative flex flex-col gap-2">
          <span className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {dragging ? "Drop it!" : "Drop a video to begin"}
          </span>
          <span className="text-muted">or click to choose from your device · MP4, MOV, WebM · any length</span>
        </span>
        <span className="relative flex flex-wrap justify-center gap-2 text-xs text-subtle">
          <span className="rounded-full border border-line bg-bg/60 px-3 py-1">🔒 Never uploaded</span>
          <span className="rounded-full border border-line bg-bg/60 px-3 py-1">⚡ No queue, no time limit</span>
          <span className="rounded-full border border-line bg-bg/60 px-3 py-1">💾 Remembers your project</span>
        </span>
      </button>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted">Or tell it what you want to make:</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g.id)}
              className="card group relative flex flex-col items-start gap-2 p-5 text-left transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-brand/50"
            >
              {g.tag && <span className="badge badge-pro absolute right-4 top-4">{g.tag}</span>}
              <span className="text-2xl transition-transform duration-300 group-hover:scale-110">{g.emoji}</span>
              <span className="font-medium">{g.title}</span>
              <span className="text-sm leading-relaxed text-muted">{g.body}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-center text-sm text-subtle">
        No video handy? Record a minute of yourself talking on your phone, or grab a free one from{" "}
        <a href="https://www.pexels.com/videos/" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
          Pexels
        </a>
        .
      </p>
    </div>
  );
}
