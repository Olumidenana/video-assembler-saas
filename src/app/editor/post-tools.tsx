"use client";

import { useEffect, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon } from "@/components/icons";
import { schedulePosts, toIcs } from "@/lib/social/plan";
import { uploadToYouTube, YouTubeError } from "@/lib/social/youtube-upload";
import { uploadToTikTok, TikTokError } from "@/lib/social/tiktok-upload";

export interface PostFile {
  url: string;
  name: string;
  /** Caption + hashtags, when the export wrote one. */
  shareText?: string;
}

export interface YouTubeStatus {
  configured: boolean;
  allowed: boolean;
  connected: boolean;
  account: string | null;
}

export interface TikTokStatus {
  configured: boolean;
  allowed: boolean;
  connected: boolean;
  account: string | null;
}

/** Whether YouTube posting is available and connected; refreshes when the connect popup reports back. */
export function useYouTube(): [YouTubeStatus | null, () => void] {
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/youtube/status")
      .then((r) => r.json())
      .then((s: YouTubeStatus) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [tick]);
  useEffect(() => {
    const channel = new BroadcastChannel("youtube");
    channel.onmessage = () => setTick((t) => t + 1);
    return () => channel.close();
  }, []);
  return [status, () => setTick((t) => t + 1)];
}

/** Whether TikTok posting is available and connected; refreshes when the connect popup reports back. */
export function useTikTok(): [TikTokStatus | null, () => void] {
  const [status, setStatus] = useState<TikTokStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/tiktok/status")
      .then((r) => r.json())
      .then((s: TikTokStatus) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [tick]);
  useEffect(() => {
    const channel = new BroadcastChannel("tiktok");
    channel.onmessage = () => setTick((t) => t + 1);
    return () => channel.close();
  }, []);
  return [status, () => setTick((t) => t + 1)];
}

const titleOf = (f: PostFile) => (f.shareText?.split("\n")[0]?.trim() || f.name.replace(/\.mp4$/, "")).slice(0, 90);
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Post one clip straight to YouTube Shorts, now or at a set time (Studio). */
export function YouTubeButton({ file, status, refresh }: { file: PostFile; status: YouTubeStatus | null; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(() => titleOf(file));
  const [description, setDescription] = useState(file.shareText ?? "");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState(() => toLocalInput(schedulePosts([{ file: "", title: "", caption: "" }], new Date())[0].at));
  const [state, setState] = useState<{ phase: "idle" | "uploading" | "done" | "error"; progress?: number; message?: string; link?: string }>({ phase: "idle" });

  if (!status?.configured) {
    return (
      <span className="relative inline-flex items-center" title="YouTube posting not set up by the site owner (GOOGLE_CLIENT_ID missing)">
        <button type="button" disabled className="btn btn-secondary btn-sm opacity-60 cursor-not-allowed">
          YouTube
        </button>
      </span>
    );
  }
  if (!status.allowed) {
    return (
      <HardLink href="/pricing" className="btn btn-ghost btn-sm text-subtle" title="Post and schedule straight to YouTube on Studio">
        <LockIcon size={13} /> YouTube
      </HardLink>
    );
  }
  if (!status.connected) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => window.open("/api/youtube/connect", "youtube-connect", "width=520,height=720")}
        title="Connect your YouTube channel"
      >
        Connect YouTube
      </button>
    );
  }

  async function post() {
    setState({ phase: "uploading", progress: 0 });
    try {
      const blob = await (await fetch(file.url)).blob();
      const publishAt = when === "later" ? new Date(at) : null;
      const { url } = await uploadToYouTube(blob, { title, description, publishAt, privacy: "public" }, (progress) => setState({ phase: "uploading", progress }));
      setState({ phase: "done", link: url, message: publishAt ? `Scheduled for ${publishAt.toLocaleString()}.` : "Posted." });
    } catch (err) {
      if (err instanceof YouTubeError && err.code === "not_connected") refresh();
      setState({ phase: "error", message: err instanceof Error ? err.message : "The upload didn't work." });
    }
  }

  return (
    <span className="relative">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        YouTube {status.account ? `(${status.account})` : ""}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 flex w-80 flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-xl" data-testid="youtube-post">
          <p className="text-xs text-subtle">Posting to {status.account ?? "your channel"} as a Short</p>
          <label className="flex flex-col gap-1 text-xs text-subtle">
            Title
            <input className="input text-sm" value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-subtle">
            Description
            <textarea className="input min-h-20 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="flex gap-2 text-xs" role="radiogroup" aria-label="When">
            {(["now", "later"] as const).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={when === w} onClick={() => setWhen(w)} className={`rounded-full border px-3 py-1 ${when === w ? "border-brand/60 bg-brand/15" : "border-line text-muted"}`}>
                {w === "now" ? "Post now" : "Schedule"}
              </button>
            ))}
          </div>
          {when === "later" && <input type="datetime-local" className="input text-sm" value={at} min={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />}
          {state.phase === "uploading" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }} />
            </div>
          )}
          {state.phase === "done" && (
            <p className="text-xs text-ok">
              {state.message}{" "}
              <a href={state.link} target="_blank" rel="noopener noreferrer" className="underline">
                Open on YouTube
              </a>
            </p>
          )}
          {state.phase === "error" && <p className="text-xs text-danger">{state.message}</p>}
          <button type="button" className="btn btn-primary btn-sm" disabled={state.phase === "uploading" || !title.trim()} onClick={() => void post()}>
            {state.phase === "uploading" ? `Uploading ${Math.round((state.progress ?? 0) * 100)}%` : when === "later" ? "Schedule on YouTube" : "Post to YouTube"}
          </button>
        </div>
      )}
    </span>
  );
}

/** Post one clip straight to TikTok via Content Posting API (Studio). */
export function TikTokButton({ file, status, refresh }: { file: PostFile; status: TikTokStatus | null; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(() => titleOf(file));
  const [state, setState] = useState<{ phase: "idle" | "uploading" | "done" | "error"; progress?: number; message?: string }>({ phase: "idle" });

  if (!status?.configured) {
    return (
      <span className="relative inline-flex items-center" title="TikTok posting not set up by the site owner (TIKTOK_CLIENT_KEY missing)">
        <button type="button" disabled className="btn btn-secondary btn-sm opacity-60 cursor-not-allowed">
          TikTok
        </button>
      </span>
    );
  }
  if (!status.allowed) {
    return (
      <HardLink href="/pricing" className="btn btn-ghost btn-sm text-subtle" title="Post straight to TikTok on Studio">
        <LockIcon size={13} /> TikTok
      </HardLink>
    );
  }
  if (!status.connected) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => window.open("/api/tiktok/connect", "tiktok-connect", "width=520,height=720")}
        title="Connect your TikTok account"
      >
        Connect TikTok
      </button>
    );
  }

  async function post() {
    setState({ phase: "uploading", progress: 0 });
    try {
      const blob = await (await fetch(file.url)).blob();
      const res = await uploadToTikTok(blob, { title }, (progress) => setState({ phase: "uploading", progress }));
      setState({
        phase: "done",
        message: res.mode === "inbox" ? "Uploaded to TikTok! Check your TikTok app notifications to complete posting." : "Posted to TikTok.",
      });
    } catch (err) {
      if (err instanceof TikTokError && err.code === "not_connected") refresh();
      setState({ phase: "error", message: err instanceof Error ? err.message : "The upload didn't work." });
    }
  }

  return (
    <span className="relative">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        TikTok {status.account ? `(@${status.account})` : ""}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 flex w-80 flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-xl" data-testid="tiktok-post">
          <p className="text-xs text-subtle">Posting to TikTok {status.account ? `@${status.account}` : "account"} via Content Posting API</p>
          <label className="flex flex-col gap-1 text-xs text-subtle">
            Caption
            <input className="input text-sm" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {state.phase === "uploading" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }} />
            </div>
          )}
          {state.phase === "done" && <p className="text-xs text-ok">{state.message}</p>}
          {state.phase === "error" && <p className="text-xs text-danger">{state.message}</p>}
          <button type="button" className="btn btn-primary btn-sm" disabled={state.phase === "uploading"} onClick={() => void post()}>
            {state.phase === "uploading" ? `Uploading ${Math.round((state.progress ?? 0) * 100)}%` : "Send to TikTok"}
          </button>
        </div>
      )}
    </span>
  );
}

/** WhatsApp direct sharing: Web Share API (Status or chats) on mobile; auto-download + wa.me on desktop. */
export function WhatsAppButton({ file }: { file: PostFile }) {
  const [guide, setGuide] = useState(false);

  async function share() {
    if (file.shareText) await navigator.clipboard?.writeText(file.shareText).catch(() => {});
    const blob = await (await fetch(file.url)).blob();
    const mp4 = new File([blob], file.name, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [mp4] })) {
      try {
        await navigator.share({ files: [mp4], title: file.name, ...(file.shareText ? { text: file.shareText } : {}) });
        return;
      } catch {
        return;
      }
    }
    // Desktop fallback: download video and open WhatsApp Web with caption text
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name;
    a.click();
    setGuide(true);
    const param = file.shareText ? `?text=${encodeURIComponent(file.shareText)}` : "";
    window.open(`https://wa.me/${param}`, "_blank", "noopener,noreferrer");
  }

  return (
    <span className="relative">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void share()} title="Share to WhatsApp Status or chats">
        WhatsApp
      </button>
      {guide && (
        <div className="absolute right-0 top-full z-20 mt-2 flex w-72 flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-xs shadow-xl">
          <p className="font-medium text-fg">Video downloaded & caption copied!</p>
          <p className="text-muted">In WhatsApp Web, open any chat or Status, click 📎 Attach → Photos & Videos, and pick your downloaded video.</p>
          <button type="button" className="btn btn-ghost btn-sm self-end" onClick={() => setGuide(false)}>
            Got it
          </button>
        </div>
      )}
    </span>
  );
}

/** Instagram Reels sharing: Web Share API on mobile; auto-download + instagram.com on desktop. */
export function InstagramButton({ file }: { file: PostFile }) {
  const [guide, setGuide] = useState(false);

  async function share() {
    if (file.shareText) await navigator.clipboard?.writeText(file.shareText).catch(() => {});
    const blob = await (await fetch(file.url)).blob();
    const mp4 = new File([blob], file.name, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [mp4] })) {
      try {
        await navigator.share({ files: [mp4], title: file.name, ...(file.shareText ? { text: file.shareText } : {}) });
        return;
      } catch {
        return;
      }
    }
    // Desktop fallback: download video and open instagram.com
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name;
    a.click();
    setGuide(true);
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  }

  return (
    <span className="relative">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void share()} title="Share to Instagram Reels">
        Instagram
      </button>
      {guide && (
        <div className="absolute right-0 top-full z-20 mt-2 flex w-72 flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-xs shadow-xl">
          <p className="font-medium text-fg">Video downloaded & caption copied!</p>
          <p className="text-muted">On Instagram, click Create (+) → Reel, select your downloaded video, and paste the caption.</p>
          <button type="button" className="btn btn-ghost btn-sm self-end" onClick={() => setGuide(false)}>
            Got it
          </button>
        </div>
      )}
    </span>
  );
}

/** Full-featured post panel per finished video with honesty badges and clear destination buttons. */
export function PostPanel({
  file,
  youtube,
  refreshYouTube,
  tiktok,
  refreshTikTok,
  canShare,
}: {
  file: PostFile;
  youtube: YouTubeStatus | null;
  refreshYouTube: () => void;
  tiktok: TikTokStatus | null;
  refreshTikTok: () => void;
  canShare: boolean;
}) {
  async function systemShare() {
    if (file.shareText) await navigator.clipboard?.writeText(file.shareText).catch(() => {});
    const blob = await (await fetch(file.url)).blob();
    const mp4 = new File([blob], file.name, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [mp4] })) {
      await navigator.share({ files: [mp4], title: file.name, ...(file.shareText ? { text: file.shareText } : {}) }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.href = file.url;
      a.download = file.name;
      a.click();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2" data-testid="post-panel">
      <YouTubeButton file={file} status={youtube} refresh={refreshYouTube} />
      <TikTokButton file={file} status={tiktok} refresh={refreshTikTok} />
      <WhatsAppButton file={file} />
      <InstagramButton file={file} />
      {canShare && (
        <button type="button" className="btn btn-ghost btn-sm text-subtle hover:text-fg" onClick={() => void systemShare()} title="System share sheet">
          More…
        </button>
      )}
    </div>
  );
}

/**
 * Posting plan: spreads the clips over the coming days at lunch and evening
 * times and downloads a calendar file with a reminder and the caption for
 * each, so posting to TikTok, Instagram or WhatsApp is one tap when it fires.
 */
export function PostPlanner({ files }: { files: PostFile[] }) {
  const [perDay, setPerDay] = useState<1 | 2>(1);
  const plan = schedulePosts(
    files.map((f) => ({ file: f.name, title: titleOf(f), caption: f.shareText ?? "" })),
    new Date(),
    perDay,
  );
  function download() {
    const url = URL.createObjectURL(new Blob([toIcs(plan)], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "posting-plan.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-4 text-sm" data-testid="post-planner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">📅 Posting plan</p>
        <div className="flex gap-1.5 text-xs" role="radiogroup" aria-label="Posts per day">
          {([1, 2] as const).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={perDay === n} onClick={() => setPerDay(n)} className={`rounded-full border px-3 py-1 ${perDay === n ? "border-brand/60 bg-brand/15" : "border-line text-muted"}`}>
              {n} a day
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">Posting steadily, in order, beats posting everything at once. Add the plan to your calendar for a reminder with each caption.</p>
      <ol className="flex flex-col gap-1 text-xs">
        {plan.map((p) => (
          <li key={p.file} className="flex justify-between gap-3">
            <span className="truncate">{p.title}</span>
            <span className="shrink-0 text-subtle">{p.at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-secondary btn-sm self-start" onClick={download}>
        Add to calendar (.ics)
      </button>
    </div>
  );
}
