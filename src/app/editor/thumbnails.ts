"use client";

import { useEffect, useState } from "react";

/**
 * Still frames from the user's own videos (blob: URLs, so the canvas is never
 * tainted), for thumbnails in the segment list and clip cards. One hidden
 * <video> per source; captures for the same source run one at a time.
 */
const frames = new Map<string, Promise<string | null>>();
const queues = new Map<string, Promise<unknown>>();
const videos = new Map<string, HTMLVideoElement>();

const TIMEOUT_MS = 8000;

function once(v: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      v.removeEventListener(event, onOk);
      v.removeEventListener("error", onErr);
      if (ok) resolve();
      else reject(new Error("frame unavailable"));
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), TIMEOUT_MS);
    v.addEventListener(event, onOk);
    v.addEventListener("error", onErr);
  });
}

async function capture(url: string, time: number, width: number): Promise<string | null> {
  let v = videos.get(url);
  if (!v) {
    v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    videos.set(url, v);
    await once(v, "loadeddata");
  }
  v.currentTime = Math.max(0, Math.min(time, (v.duration || time) - 0.05));
  await once(v, "seeked");
  if (!v.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * v.videoHeight) / v.videoWidth);
  canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/** A JPEG data URL of the frame at `time`, or null if the browser can't decode this video. */
export function thumbnail(url: string, time: number, width = 240): Promise<string | null> {
  const key = `${url}#${time.toFixed(1)}#${width}`;
  let frame = frames.get(key);
  if (!frame) {
    frame = (queues.get(url) ?? Promise.resolve()).then(() => capture(url, time, width)).catch(() => null);
    queues.set(url, frame);
    frames.set(key, frame);
  }
  return frame;
}

/** Drops cached frames for a source that's been removed (its blob URL is revoked). */
export function forgetThumbnails(url: string) {
  videos.get(url)?.removeAttribute("src");
  videos.delete(url);
  queues.delete(url);
  for (const key of frames.keys()) if (key.startsWith(`${url}#`)) frames.delete(key);
}

export function useThumbnail(url: string | undefined, time: number, width?: number): string | null {
  const [state, setState] = useState<{ key: string; src: string | null } | null>(null);
  const key = url ? `${url}#${time.toFixed(1)}` : "";
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void thumbnail(url, time, width).then((src) => alive && setState({ key, src }));
    return () => {
      alive = false;
    };
  }, [url, time, width, key]);
  return state?.key === key ? state.src : null;
}
