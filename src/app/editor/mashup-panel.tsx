"use client";

import { useEffect, useRef, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon, SparkIcon, UploadIcon } from "@/components/icons";
import type { Beat, Mashup } from "@/lib/assistant/mashup";
import { MUSIC_STYLES, type MusicStyle } from "@/lib/audio/music";
import type { PlanLimits } from "@/lib/plans";
import { TRANSITIONS, type TransitionType } from "@/lib/video/transitions";
import { formatTime } from "./format";
import { useThumbnail } from "./thumbnails";

export interface MashupVideoInfo {
  id: string;
  name: string;
  url: string;
  color: string;
}

export interface MashupChoice {
  transition: TransitionType | "auto";
  music: MusicStyle | "none";
}

/**
 * Mashups: pick several videos, find the moments that belong together across
 * them (same feel, or with AI Theme Match the same story theme), preview the
 * cut live and export it with transitions and a beat that drops on the
 * biggest moment.
 */
export function MashupPanel({
  videos,
  limits,
  busy,
  mashups,
  onFind,
  onMake,
  onTimeline,
  onAddVideos,
}: {
  videos: MashupVideoInfo[];
  limits: PlanLimits;
  busy: boolean;
  mashups: Mashup[] | null;
  onFind: (videoIds: string[], ai: boolean) => void;
  onMake: (mashup: Mashup, choice: MashupChoice) => void;
  onTimeline: (mashup: Mashup) => void;
  onAddVideos: () => void;
}) {
  // Every video is in, up to the plan's limit, except the ones switched off.
  const [off, setOff] = useState<string[]>([]);
  const [ai, setAi] = useState(limits.aiVision);
  const picked = videos.filter((v) => !off.includes(v.id)).slice(0, limits.mashupVideos).map((v) => v.id);
  const toggle = (id: string) => setOff((o) => (picked.includes(id) ? [...o, id] : o.filter((x) => x !== id)));
  const byId = Object.fromEntries(videos.map((v) => [v.id, v]));

  return (
    <section
      id="tool-mashup"
      className="relative scroll-mt-32 overflow-hidden rounded-2xl bg-gradient-to-br from-[#ff7ac6]/60 via-brand/40 to-transparent p-px"
      data-testid="mashup"
    >
      <div className="relative flex flex-col gap-5 rounded-2xl bg-surface p-5 sm:p-6">
        <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-[#ff7ac6]/15 blur-3xl animate-drift" />
        <div className="relative flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-[#ff7ac6] to-brand text-lg shadow-lg shadow-[#ff7ac6]/30" aria-hidden>
            🎞️
          </span>
          <div>
            <h2 className="text-lg font-semibold">Mashup</h2>
            <p className="text-sm text-muted">
              Cut between several videos on moments that belong together: fights from different anime, the same feeling in a film and a series. We match them, add transitions and a beat that drops on the biggest one.
            </p>
          </div>
        </div>

        {videos.length < 2 ? (
          <div className="relative flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4 text-sm">
            <p className="text-muted">
              Add at least one more video to mix with this one: another episode, a different anime, a movie, a game clip. Videos you add are matched together.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onAddVideos}>
              <UploadIcon size={14} /> Add videos
            </button>
          </div>
        ) : (
          <>
            <div className="relative flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">
                Videos to mix ({picked.length}/{Math.min(videos.length, limits.mashupVideos)})
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Videos to mix">
                {videos.map((v) => {
                  const on = picked.includes(v.id);
                  const full = !on && picked.length >= limits.mashupVideos;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={on}
                      disabled={full}
                      title={full ? `Your plan mixes up to ${limits.mashupVideos} videos` : undefined}
                      onClick={() => toggle(v.id)}
                      className={`flex max-w-[16rem] items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        on ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-muted hover:border-line-strong"
                      } ${full ? "opacity-50" : ""}`}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: v.color }} />
                      <span className="truncate">{v.name}</span>
                    </button>
                  );
                })}
                <button type="button" className="rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:text-fg" onClick={onAddVideos}>
                  + Add
                </button>
              </div>
              {videos.length > limits.mashupVideos && (
                <HardLink href="/pricing" className="flex items-center gap-1 text-xs text-subtle hover:text-fg">
                  <LockIcon size={11} /> {limits.label} mixes {limits.mashupVideos} videos at a time. Pro: 5, Studio: 12.
                </HardLink>
              )}
            </div>

            <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              {limits.aiVision ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="accent-brand" />
                  <span>
                    <span className="font-medium">AI Theme Match</span>{" "}
                    <span className="text-muted">looks at the moments and groups them by story: rivals, sacrifice, betrayal, power-ups (10 AI credits)</span>
                  </span>
                </label>
              ) : (
                <HardLink href="/pricing" className="flex items-center gap-1.5 text-muted hover:text-fg">
                  <LockIcon size={12} /> AI Theme Match, which groups moments by story theme across videos, is on Studio
                </HardLink>
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg relative self-start"
              disabled={busy || picked.length < 2}
              onClick={() => onFind(picked, ai && limits.aiVision)}
            >
              <SparkIcon size={16} /> {mashups ? "Find matches again" : `Find matches in ${picked.length} videos`}
            </button>
          </>
        )}

        {mashups && mashups.length === 0 && (
          <p className="relative text-sm text-muted">
            Nothing matched strongly enough across these videos. Try videos with more action or emotion, or add another one.
          </p>
        )}
        {mashups && mashups.length > 0 && (
          <ul className="relative grid gap-4 lg:grid-cols-2" data-testid="mashup-list">
            {mashups.map((m) => (
              <MashupCard key={m.id} mashup={m} videos={byId} busy={busy} onMake={onMake} onTimeline={onTimeline} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MashupCard({
  mashup,
  videos,
  busy,
  onMake,
  onTimeline,
}: {
  mashup: Mashup;
  videos: Record<string, MashupVideoInfo>;
  busy: boolean;
  onMake: (m: Mashup, choice: MashupChoice) => void;
  onTimeline: (m: Mashup) => void;
}) {
  const [transition, setTransition] = useState<TransitionType | "auto">("auto");
  const [music, setMusic] = useState<MusicStyle | "none">(mashup.music);
  const from = [...new Set(mashup.beats.map((b) => b.clipId))];
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-4" data-testid="mashup-card">
      <MashupPreview beats={mashup.beats} videos={videos} transition={transition === "auto" ? mashup.transition : transition} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">
            {mashup.emoji} {mashup.title}
            {mashup.ai && <span className="badge badge-pro ml-2 align-middle">AI theme</span>}
          </p>
          <p className="text-xs text-subtle">
            {mashup.beats.length} moments · {from.length} videos · about {Math.round(mashup.length)}s
          </p>
        </div>
      </div>
      <p className="border-l-2 border-brand/50 pl-3 text-sm italic text-muted">“{mashup.hook}”</p>
      <p className="text-xs text-muted">{mashup.why}</p>
      <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Moments in order">
        {mashup.beats.map((b, i) => (
          <BeatThumb key={b.id} beat={b} index={i} video={videos[b.clipId]} />
        ))}
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-subtle">
          Transition
          <select className="input py-1.5 text-sm" value={transition} onChange={(e) => setTransition(e.target.value as TransitionType | "auto")}>
            <option value="auto">Auto (suits each cut)</option>
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id} title={t.hint}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          Music
          <select className="input py-1.5 text-sm" value={music} onChange={(e) => setMusic(e.target.value as MusicStyle | "none")}>
            {MUSIC_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="none">No music (original sound)</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onMake(mashup, { transition, music })}>
          Make this mashup
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onTimeline(mashup)}>
          Edit on timeline
        </button>
      </div>
    </li>
  );
}

function BeatThumb({ beat, index, video }: { beat: Beat; index: number; video: MashupVideoInfo | undefined }) {
  const still = useThumbnail(video?.url, beat.peak, 160);
  return (
    <li className="relative w-20 shrink-0 overflow-hidden rounded-md bg-black" title={`${video?.name ?? "video"} @ ${formatTime(beat.start)}`}>
      <div className="aspect-video">
        {still && (
          // eslint-disable-next-line @next/next/no-img-element -- a frame from the user's own local video
          <img src={still} alt="" className="size-full object-cover" />
        )}
      </div>
      <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: video?.color }} />
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white">{index + 1}</span>
    </li>
  );
}

/**
 * Plays the mashup's beats one after another from the user's own files, with
 * a flash or fade between them, so the cut can be judged before exporting.
 */
function MashupPreview({ beats, videos, transition }: { beats: Beat[]; videos: Record<string, MashupVideoInfo>; transition: TransitionType }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const beat = beats[index];
  const poster = useThumbnail(videos[beats[0]?.clipId]?.url, beats[0]?.peak ?? 0, 480);

  useEffect(() => {
    const v = ref.current;
    if (!v || !beat) return;
    if (!playing) {
      v.pause();
      return;
    }
    const url = videos[beat.clipId]?.url;
    if (!url) return;
    const go = () => {
      v.currentTime = beat.start;
      v.play().catch(() => setPlaying(false));
    };
    if (v.getAttribute("src") !== url) {
      v.setAttribute("src", url);
      v.addEventListener("loadedmetadata", go, { once: true });
      v.load();
    } else {
      go();
    }
  }, [beat, playing, videos]);

  const flash = transition === "fadewhite" ? "bg-white" : "bg-black";
  return (
    <div className="group relative aspect-video overflow-hidden rounded-lg bg-black" data-testid="mashup-preview">
      {poster && !playing && (
        // eslint-disable-next-line @next/next/no-img-element -- a frame from the user's own local video
        <img src={poster} alt="" className="absolute inset-0 size-full object-contain" />
      )}
      <video
        ref={ref}
        muted={!sound}
        playsInline
        preload="none"
        onTimeUpdate={(e) => {
          if (beat && e.currentTarget.currentTime >= beat.end) setIndex((i) => (i + 1) % beats.length);
        }}
        className={`absolute inset-0 size-full object-contain ${playing ? "opacity-100" : "opacity-0"}`}
      />
      {playing && <div key={index} className={`pointer-events-none absolute inset-0 animate-cut ${flash}`} />}
      {playing && beat && (
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white backdrop-blur">
          <span className="size-2 rounded-full" style={{ background: videos[beat.clipId]?.color }} />
          {index + 1}/{beats.length} · {videos[beat.clipId]?.name}
        </span>
      )}
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        {playing && (
          <button type="button" onClick={() => setSound((s) => !s)} className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
            {sound ? "🔊" : "🔇"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setPlaying((p) => !p);
          }}
          className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur"
        >
          {playing ? "■ Stop" : "▶ Preview the cut"}
        </button>
      </div>
    </div>
  );
}
