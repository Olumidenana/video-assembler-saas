"use client";

import { useEffect, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { LockIcon } from "@/components/icons";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { formatBytes } from "./format";

interface Tool {
  id: string;
  label: string;
  icon: string;
  /** What this plan gets, e.g. "Top clip only". */
  note?: (plan: PlanId) => string | null;
  /** The plan needed to use it fully, when this one doesn't. */
  needs?: (plan: PlanId) => "Pro" | "Studio" | null;
}

const TOOLS: Tool[] = [
  { id: "tool-start", label: "Add videos", icon: "➕" },
  {
    id: "tool-pack",
    label: "Clip Pack",
    icon: "⚡",
    note: (p) => `${PLAN_LIMITS[p].packClips} clip${PLAN_LIMITS[p].packClips === 1 ? "" : "s"}`,
    needs: (p) => (PLAN_LIMITS[p].aiVision ? null : "Studio"),
  },
  {
    id: "tool-mashup",
    label: "Mashup",
    icon: "🎞️",
    note: (p) => `${PLAN_LIMITS[p].mashupVideos} videos`,
    needs: (p) => (PLAN_LIMITS[p].aiVision ? null : "Studio"),
  },
  {
    id: "tool-viral",
    label: "Viral clips",
    icon: "🔥",
    note: (p) => (p === "free" ? "Top clip" : p === "pro" ? `Top ${PLAN_LIMITS.pro.viralClipExports}` : "Unlimited"),
    needs: (p) => (p === "studio" ? null : "Studio"),
  },
  { id: "tool-edit", label: "Auto-edit", icon: "✨" },
  { id: "tool-timeline", label: "Timeline", icon: "🎞️" },
  {
    id: "tool-captions",
    label: "Captions",
    icon: "💬",
    note: (p) => (Number.isFinite(PLAN_LIMITS[p].captionSeconds) ? `First ${PLAN_LIMITS[p].captionSeconds}s` : null),
    needs: (p) => (PLAN_LIMITS[p].captionStyles === "all" ? null : p === "free" ? "Pro" : "Studio"),
  },
  { id: "tool-music", label: "Music", icon: "🎵" },
  {
    id: "tool-brand",
    label: "Format & logo",
    icon: "🏷️",
    needs: (p) => (PLAN_LIMITS[p].brandLogo ? null : "Studio"),
  },
  { id: "export", label: "Export", icon: "⬇️", note: (p) => (PLAN_LIMITS[p].watermark ? "720p · watermark" : null) },
];

/**
 * The editor's workspace navigation: every tool in one place (a sidebar on
 * desktop, a chip bar on phones), what the plan includes, and the upgrade.
 */
export function WorkspaceNav({ plan, hasVideos, totalBytes }: { plan: PlanId; hasVideos: boolean; totalBytes: number }) {
  const [active, setActive] = useState("tool-start");

  // Scroll-spy: the active tool is the section whose top most recently passed a third of the way down the screen.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      // Sections nest (Export holds Captions and Music), so pick the passed one nearest the line.
      let current = "tool-start";
      let nearest = -Infinity;
      for (const t of TOOLS) {
        const top = document.getElementById(t.id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line && top > nearest) {
          nearest = top;
          current = t.id;
        }
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hasVideos]);

  const go = (id: string) => {
    const target = hasVideos || id === "tool-start" ? id : "tool-start";
    setActive(target);
    const el = document.getElementById(target);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const limits = PLAN_LIMITS[plan];

  const item = (t: Tool, compact: boolean) => {
    const needs = t.needs?.(plan) ?? null;
    const note = t.note?.(plan) ?? null;
    const disabled = !hasVideos && t.id !== "tool-start";
    const on = active === t.id;
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => go(t.id)}
        aria-current={on ? "true" : undefined}
        title={disabled ? "Add a video first" : needs ? `More with ${needs}` : undefined}
        className={
          compact
            ? `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${on ? "border-brand/60 bg-brand/15 text-fg" : "border-line text-muted"} ${disabled ? "opacity-50" : ""}`
            : `group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${on ? "bg-brand/15 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"} ${disabled ? "opacity-50" : ""}`
        }
      >
        <span aria-hidden>{t.icon}</span>
        <span className="flex-1">{t.label}</span>
        {!compact && (needs || note) && (
          <span className="flex items-center gap-1 text-[10px] text-subtle">
            {needs && <LockIcon size={10} />}
            {note ?? needs}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <nav className="sticky top-16 z-20 -mx-4 mb-4 flex gap-2 overflow-x-auto border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur lg:hidden" aria-label="Tools">
        {TOOLS.map((t) => item(t, true))}
      </nav>

      <aside className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-4">
          <nav className="flex flex-col gap-0.5" aria-label="Tools">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-subtle">Workspace</p>
            {TOOLS.map((t) => item(t, false))}
          </nav>

          <div className="card flex flex-col gap-3 p-4 text-sm" data-testid="plan-card">
            <div className="flex items-center justify-between">
              <span className="font-medium">{limits.label} plan</span>
              {plan !== "free" && <span className="badge badge-pro">Active</span>}
            </div>
            <ul className="flex flex-col gap-1 text-xs text-muted">
              <li>{limits.watermark ? "Watermark on exports" : "No watermark"}</li>
              <li>{Number.isFinite(limits.maxShortSide) ? `Up to ${limits.maxShortSide}p` : "Full quality"}</li>
              <li>{Number.isFinite(limits.viralClipExports) ? `${limits.viralClipExports} viral clip${limits.viralClipExports === 1 ? "" : "s"} per video` : "Unlimited viral clips"}</li>
              <li>{limits.aiDailyLimit} AI credits a day</li>
            </ul>
            {plan !== "studio" && (
              <HardLink href="/pricing" className="btn btn-primary btn-sm w-full">
                {plan === "free" ? "Upgrade" : "Go Studio"}
              </HardLink>
            )}
          </div>

          {totalBytes > 0 && (
            <p className="px-1 text-xs text-subtle" data-testid="data-saved">
              🔒 0 MB uploaded. You saved {formatBytes(totalBytes)} of data by editing on your device.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
