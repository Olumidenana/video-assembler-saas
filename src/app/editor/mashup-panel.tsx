"use client";

import { useEffect, useRef, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon, SparkIcon, UploadIcon } from "@/components/icons";
import type { EditFormat, EditPlan, Shot } from "@/lib/assistant/beat-edit";
import { MUSIC_STYLES, type MusicStyle } from "@/lib/audio/music";
import type { PlanLimits } from "@/lib/plans";
import { useThumbnail } from "./thumbnails";

export interface MashupVideoInfo {
  id: string;
  name: string;
  url: string;
  color: string;
}

/** Beats that suit each kind of edit (the cuts follow the beat, so changing it re-cuts the edit). */
export const EDIT_STYLES: Record<EditFormat, MusicStyle[]> = {
  hype: ["phonk", "trap"],
  versus: ["trap", "phonk"],
  feels: ["cinematic", "lofi"],
  quote: ["cinematic", "trap", "lofi"],
  countdown: ["lofi", "trap", "afro"],
};

/** Formats cut to the beat grid (intro, build, drop, slow motion); the others follow the speech. */
const BEAT_FORMATS: EditFormat[] = ["hype", "versus", "feels"];

/** The seed the export composes with, so the preview plays the same track. */
export const musicSeed = (plan: EditPlan) => Math.round(plan.shots[0].start * 10) + plan.shots.length;

/**
 * Edits: beat-synced fan edits and mashups from one or more videos, built the
 * way viral edits are (music first, every cut on a beat, the big hit on the
 * drop, a slow-motion ending that loops). Each card plays the edit live with
 * its music before anything is exported.
 */
export function MashupPanel({
  videos,
  limits,
  busy,
  edits,
  onFind,
  onMake,
  onTimeline,
  onRestyle,
  onAddVideos,
}: {
  videos: MashupVideoInfo[];
  limits: PlanLimits;
  busy: boolean;
  edits: EditPlan[] | null;
  onFind: (videoIds: string[], ai: boolean) => void;
  onMake: (plan: EditPlan) => void;
  onTimeline: (plan: EditPlan) => void;
  onRestyle: (plan: EditPlan, music: MusicStyle) => void;
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
            <h2 className="text-lg font-semibold">Edits & mashups</h2>
            <p className="text-sm text-muted">
              Edits built the way viral shorts are, for whatever you clip. Action (anime, gaming, sports): beat-synced edits with the big hit on the drop. Talking (podcasts, streams, interviews): quote edits with punch-in zooms and captions, and Top 3 countdowns.
            </p>
          </div>
        </div>

        <div className="relative flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">
            Videos to use ({picked.length}/{Math.min(videos.length, limits.mashupVideos)})
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Videos to use">
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
            <button type="button" className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:text-fg" onClick={onAddVideos}>
              <UploadIcon size={12} /> Add
            </button>
          </div>
          {videos.length < 2 && (
            <p className="text-xs text-subtle">Add a second video (another episode, anime or film) for a mashup and a versus edit.</p>
          )}
          {videos.length > limits.mashupVideos && (
            <HardLink href="/pricing" className="flex items-center gap-1 text-xs text-subtle hover:text-fg">
              <LockIcon size={11} /> {limits.label} mixes {limits.mashupVideos} videos at a time. Pro: 5, Studio: 12.
            </HardLink>
          )}
        </div>

        {videos.length >= 2 &&
          (limits.aiVision ? (
            <label className="relative flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="accent-brand" />
              <span>
                <span className="font-medium">AI Theme Match</span>{" "}
                <span className="text-muted">looks at the moments and builds an edit around a shared story: rivals, sacrifice, betrayal, power-ups (10 AI credits)</span>
              </span>
            </label>
          ) : (
            <HardLink href="/pricing" className="relative flex items-center gap-1.5 text-sm text-muted hover:text-fg">
              <LockIcon size={12} /> AI Theme Match, which builds edits around a shared story across videos, is on Studio
            </HardLink>
          ))}

        <button
          type="button"
          className="btn btn-primary btn-lg relative self-start"
          disabled={busy || picked.length < 1}
          onClick={() => onFind(picked, ai && limits.aiVision && picked.length >= 2)}
        >
          <SparkIcon size={16} /> {edits ? "Make new edits" : picked.length > 1 ? `Make edits from ${picked.length} videos` : "Make edits"}
        </button>

        {edits && edits.length === 0 && (
          <p className="relative text-sm text-muted">
            There weren&apos;t enough strong moments for an edit. Try a video with more action or emotion, or add another one.
          </p>
        )}
        {edits && edits.length > 0 && (
          <ul className="relative grid gap-4 xl:grid-cols-2" data-testid="mashup-list">
            {edits.map((p) => (
              <EditCard key={p.id} plan={p} videos={byId} busy={busy} onMake={onMake} onTimeline={onTimeline} onRestyle={onRestyle} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EditCard({
  plan,
  videos,
  busy,
  onMake,
  onTimeline,
  onRestyle,
}: {
  plan: EditPlan;
  videos: Record<string, MashupVideoInfo>;
  busy: boolean;
  onMake: (p: EditPlan) => void;
  onTimeline: (p: EditPlan) => void;
  onRestyle: (p: EditPlan, music: MusicStyle) => void;
}) {
  const from = [...new Set(plan.shots.map((s) => s.clipId))];
  const styles = plan.ai ? [plan.music] : EDIT_STYLES[plan.format];
  return (
    <li className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2/60 p-4 sm:flex-row" data-testid="mashup-card">
      <EditPreview plan={plan} videos={videos} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <p className="font-medium leading-snug">
            {plan.emoji} {plan.title}
            {plan.ai && <span className="badge badge-pro ml-2 align-middle">AI theme</span>}
          </p>
          <p className="text-xs text-subtle">
            {plan.shots.length} cuts · {from.length} video{from.length === 1 ? "" : "s"} · {Math.round(plan.length)}s · {plan.bpm} BPM
          </p>
        </div>
        <p className="text-xs text-muted">{plan.why}</p>
        <Structure plan={plan} videos={videos} />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Beat">
          {styles.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={plan.music === m}
              disabled={busy}
              onClick={() => plan.music !== m && onRestyle(plan, m)}
              className={`rounded-full border px-3 py-1 text-xs ${plan.music === m ? "border-brand/60 bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"}`}
            >
              {MUSIC_STYLES.find((s) => s.id === m)?.label}
            </button>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onMake(plan)}>
            Export this edit
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onTimeline(plan)}>
            Edit on timeline
          </button>
        </div>
      </div>
    </li>
  );
}

/** The edit's shape: a bar per shot, as wide as its beats, colored by video, with the drop marked. */
function Structure({ plan, videos }: { plan: EditPlan; videos: Record<string, MashupVideoInfo> }) {
  if (!BEAT_FORMATS.includes(plan.format)) return <TalkStructure plan={plan} videos={videos} />;
  const total = plan.shots.reduce((s, x) => s + x.beats, 0);
  const at = plan.shots.reduce<number[]>((acc, x, i) => [...acc, i ? acc[i - 1] + plan.shots[i - 1].beats : 0], []);
  const dropBeat = plan.shots.slice(0, plan.shots.findIndex((x) => x.role === "drop")).reduce((s, x) => s + x.beats, 0);
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex h-7 gap-px overflow-hidden rounded-md" aria-label="Cuts">
        {plan.shots.map((s, i) => (
          <span
            key={i}
            title={`${s.role} · ${s.beats} beat${s.beats === 1 ? "" : "s"}${s.speed ? " · slow motion" : ""}`}
            className={`h-full ${s.role === "drop" || s.role === "outro" ? "opacity-100" : "opacity-60"}`}
            style={{ width: `${(s.beats / total) * 100}%`, background: videos[s.clipId]?.color ?? "#888", marginLeft: at[i] === dropBeat ? 2 : 0 }}
          />
        ))}
        <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(dropBeat / total) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-subtle">
        <span>Intro</span>
        <span>Build</span>
        <span className="text-fg">Drop</span>
        <span>Slow-mo</span>
      </div>
    </div>
  );
}

/** Talking edits: the clips to scale, with their countdown numbers or punch-ins. */
function TalkStructure({ plan, videos }: { plan: EditPlan; videos: Record<string, MashupVideoInfo> }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-7 gap-px overflow-hidden rounded-md" aria-label="Cuts">
        {plan.shots.map((s, i) => (
          <span
            key={i}
            className={`grid h-full place-items-center text-[10px] font-semibold text-black ${s.fx?.zoom ? "opacity-100" : "opacity-70"}`}
            style={{ width: `${((s.end - s.start) / plan.length) * 100}%`, background: videos[s.clipId]?.color ?? "#888" }}
          >
            {plan.labels?.[i]?.text}
          </span>
        ))}
      </div>
      <p className="text-[10px] uppercase tracking-wide text-subtle">
        {plan.format === "countdown" ? "Counts down to the best one" : "Wide and punched-in, switching on every bar"}
      </p>
    </div>
  );
}

/**
 * Plays the edit live: the composed track through Web Audio, and the shots
 * cut to it from the user's own files. Two video elements take turns, so the
 * next shot is already seeked while the current one plays.
 */
function EditPreview({ plan, videos }: { plan: EditPlan; videos: Record<string, MashupVideoInfo> }) {
  const first = useRef<HTMLVideoElement>(null);
  const second = useRef<HTMLVideoElement>(null);
  const el = (k: number) => (k % 2 === 0 ? first.current : second.current);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [shot, setShot] = useState(-1);
  const [time, setTime] = useState(0);
  const stopRef = useRef<() => void>(() => {});
  const poster = useThumbnail(videos[plan.shots[0]?.clipId]?.url, plan.shots[plan.shots.findIndex((s) => s.role === "drop")]?.start ?? 0, 360);
  const lengthOf = (s: Shot) => (s.end - s.start) / (s.speed ?? 1);
  const starts = plan.shots.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + lengthOf(plan.shots[i - 1]) : 0], []);
  // Talking edits play the speaker's voice, with the beat underneath.
  const voice = plan.mix.original >= 0.5;

  useEffect(() => () => stopRef.current(), []);
  // A new cut or new beat: start over.
  useEffect(() => () => stopRef.current(), [plan]);

  const prepare = (el: HTMLVideoElement | null, s: Shot | undefined) => {
    if (!el || !s) return;
    const url = videos[s.clipId]?.url;
    if (!url) return;
    if (el.getAttribute("src") !== url) el.setAttribute("src", url);
    el.pause();
    el.currentTime = s.start;
  };

  async function play() {
    if (state !== "idle") {
      stopRef.current();
      return;
    }
    setState("loading");
    const { planTrack, renderTrack } = await import("@/lib/audio/music");
    const buffer = await renderTrack(planTrack(plan.music, plan.length, plan.dropAt, musicSeed(plan)));
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = voice ? 0.3 : 1;
    src.connect(gain).connect(ctx.destination);
    prepare(el(0), plan.shots[0]);
    prepare(el(1), plan.shots[1]);
    await new Promise((r) => setTimeout(r, 250));
    const t0 = ctx.currentTime + 0.05;
    src.start(t0);
    let current = -1;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      try {
        src.stop();
      } catch {}
      void ctx.close().catch(() => {});
      el(0)?.pause();
      el(1)?.pause();
      setShot(-1);
      setState("idle");
      stopRef.current = () => {};
    };
    stopRef.current = stop;
    setState("playing");
    const tick = () => {
      const t = ctx.currentTime - t0;
      if (t >= plan.length) return stop();
      let i = current < 0 ? 0 : current;
      while (i + 1 < starts.length && t >= starts[i + 1]) i++;
      if (i !== current && t >= 0) {
        current = i;
        const active = el(i);
        const other = el(i + 1);
        if (active) {
          active.playbackRate = plan.shots[i].speed ?? 1;
          void active.play().catch(() => {});
        }
        other?.pause();
        prepare(other, plan.shots[i + 1]);
        setShot(i);
      }
      setTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  const s = shot >= 0 ? plan.shots[shot] : null;
  const flash = s?.fx?.flash ? "bg-white" : s?.fx?.dip ? "bg-black" : null;
  return (
    <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden rounded-xl bg-black sm:w-44" data-testid="mashup-preview">
      {poster && state !== "playing" && (
        // eslint-disable-next-line @next/next/no-img-element -- a frame from the user's own local video
        <img src={poster} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
      )}
      <PreviewVideo ref={first} on={state === "playing" && shot >= 0 && shot % 2 === 0} fx={s?.fx} voice={voice} />
      <PreviewVideo ref={second} on={state === "playing" && shot % 2 === 1} fx={s?.fx} voice={voice} />
      {state === "playing" && flash && <div key={shot} className={`pointer-events-none absolute inset-0 animate-cut ${flash}`} />}
      {state === "playing" && time < 3 && (
        <p className="absolute inset-x-2 top-[14%] text-center font-display text-lg uppercase leading-tight text-white [text-shadow:0_0_6px_#000,0_2px_0_#000]">{plan.hook}</p>
      )}
      {state === "playing" && plan.labels?.find((l) => time >= l.start && time < l.end) && (
        <p className="absolute left-3 top-[24%] font-display text-4xl text-[#ffd84a] [text-shadow:0_0_6px_#000,0_3px_0_#000]">
          {plan.labels.find((l) => time >= l.start && time < l.end)?.text}
        </p>
      )}
      {state === "playing" && time >= plan.length - 1.6 && (
        <p className="absolute inset-x-2 bottom-[22%] text-center font-display text-base uppercase leading-tight text-white [text-shadow:0_0_6px_#000,0_2px_0_#000]">{plan.cta}</p>
      )}
      {state === "playing" && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-brand" style={{ width: `${Math.min(100, (time / plan.length) * 100)}%` }} />
      )}
      <button
        type="button"
        onClick={() => void play()}
        className="absolute inset-0 grid place-items-center text-white"
        aria-label={state === "idle" ? "Play the edit with its music" : "Stop"}
      >
        {state !== "playing" && (
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs backdrop-blur">{state === "loading" ? "Making the beat…" : "▶ Play with music"}</span>
        )}
      </button>
    </div>
  );
}

/** One of the preview's two alternating players; punch and shake replay on every cut it shows. */
function PreviewVideo({ ref, on, fx, voice }: { ref: React.Ref<HTMLVideoElement>; on: boolean; fx: Shot["fx"]; voice: boolean }) {
  const motion = on && fx?.punch ? "animate-punch" : on && fx?.shake ? "animate-shake" : "";
  return (
    <video
      ref={ref}
      muted={!(on && voice)}
      playsInline
      preload="auto"
      className={`absolute inset-0 size-full object-cover ${on ? "opacity-100" : "opacity-0"} ${motion}`}
      style={on && fx?.zoom ? { transform: `scale(${fx.zoom})`, transformOrigin: "50% 35%" } : undefined}
    />
  );
}
