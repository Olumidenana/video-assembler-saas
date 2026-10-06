"use client";

import { useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon } from "@/components/icons";

const UPLOAD_PAGES = [
  { label: "TikTok", url: "https://www.tiktok.com/upload" },
  { label: "YouTube Shorts", url: "https://www.youtube.com/upload" },
  { label: "Instagram", url: "https://www.instagram.com/" },
];

/**
 * Share a finished clip (Studio). On phones the system share sheet hands the
 * MP4 straight to TikTok, Instagram, WhatsApp or YouTube; their own editors
 * take it from there. The caption is copied first so it can be pasted in, since
 * those apps often ignore shared text. Desktops get the caption copied and
 * links to each platform's upload page.
 */
export function ShareButton({ url, name, text, allowed }: { url: string; name: string; text?: string; allowed: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "desktop">("idle");

  if (!allowed) {
    return (
      <HardLink href="/pricing" className="btn btn-ghost btn-sm text-subtle" title="Share straight to TikTok, Reels, Shorts and WhatsApp on Studio">
        <LockIcon size={13} /> Share
      </HardLink>
    );
  }

  async function share() {
    if (text) await navigator.clipboard?.writeText(text).catch(() => {});
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], name, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name, ...(text ? { text } : {}) });
        setState(text ? "copied" : "idle");
      } catch {
        // Closing the share sheet throws AbortError; nothing to do.
      }
      return;
    }
    setState("desktop");
  }

  return (
    <span className="relative flex flex-col items-end gap-1">
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void share()}>
        Share
      </button>
      {state === "copied" && <span className="text-[11px] text-ok">Caption copied: paste it in the app</span>}
      {state === "desktop" && (
        <span className="flex flex-wrap justify-end gap-x-2 text-[11px] text-muted" data-testid="upload-links">
          {text ? "Caption copied. Download, then upload on:" : "Download, then upload on:"}
          {UPLOAD_PAGES.map((p) => (
            <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              {p.label}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}
