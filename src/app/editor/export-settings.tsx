"use client";

import { HardLink } from "@/components/hard-link";
import { LockIcon } from "@/components/icons";
import type { PlanLimits } from "@/lib/plans";
import { CAPTION_STYLES, type CaptionStyleId } from "@/lib/video/captions";
import type { Aspect, Fit } from "@/lib/video/commands";
import type { CaptionLanguage } from "@/lib/video/transcribe";

export interface ExportSettings {
  aspect: Aspect;
  fit: Fit;
  captions: boolean;
  captionStyle: CaptionStyleId;
  language: CaptionLanguage;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  aspect: "original",
  fit: "blur",
  captions: false,
  captionStyle: "clean",
  language: "english",
};

const ASPECTS: { id: Aspect; label: string; hint: string }[] = [
  { id: "original", label: "Original", hint: "Keep the shape" },
  { id: "9:16", label: "9:16", hint: "Reels · TikTok · Shorts · Status" },
  { id: "1:1", label: "1:1", hint: "Square feed" },
  { id: "16:9", label: "16:9", hint: "YouTube" },
];

interface Props {
  settings: ExportSettings;
  onChange: (s: ExportSettings) => void;
  limits: PlanLimits;
  disabled: boolean;
  logoUrl: string | null;
  onLogo: (file: File | null) => void;
}

export function ExportSettingsPanel({ settings, onChange, limits, disabled, logoUrl, onLogo }: Props) {
  const set = (patch: Partial<ExportSettings>) => onChange({ ...settings, ...patch });
  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
      active ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong"
    }`;

  return (
    <fieldset className="flex flex-col gap-5" disabled={disabled} data-testid="export-settings">
      <div className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Format</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ASPECTS.map((a) => (
            <button key={a.id} type="button" className={chip(settings.aspect === a.id)} onClick={() => set({ aspect: a.id })} aria-pressed={settings.aspect === a.id}>
              <span className="block font-medium">{a.label}</span>
              <span className="block text-xs text-muted">{a.hint}</span>
            </button>
          ))}
        </div>
        {settings.aspect !== "original" && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            Fill:
            {(["blur", "crop"] as const).map((f) => (
              <button key={f} type="button" className={`${chip(settings.fit === f)} py-1`} onClick={() => set({ fit: f })} aria-pressed={settings.fit === f}>
                {f === "blur" ? "Fit with blurred background" : "Crop to fill"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={settings.captions} onChange={(e) => set({ captions: e.target.checked })} className="accent-brand" />
          Auto-captions
          <span className="font-normal text-muted">
            {Number.isFinite(limits.captionSeconds) ? `(first ${limits.captionSeconds}s on ${limits.label})` : "(whole video)"}
          </span>
        </label>
        {settings.captions && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CAPTION_STYLES.map((s) => {
                const locked = s.studio && limits.captionStyles !== "all";
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={chip(settings.captionStyle === s.id)}
                    onClick={() => !locked && set({ captionStyle: s.id })}
                    aria-pressed={settings.captionStyle === s.id}
                    aria-disabled={locked}
                    title={locked ? "Studio plan" : s.description}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {s.label} {locked && <LockIcon size={12} className="text-subtle" />}
                    </span>
                    <span className="block text-xs text-muted">{locked ? "Studio" : s.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              Spoken language:
              <select
                value={settings.language}
                onChange={(e) => set({ language: e.target.value as CaptionLanguage })}
                className="input h-8"
                aria-label="Spoken language"
              >
                <option value="english">English (best accuracy)</option>
                <option value="other">Other / mixed (Pidgin, Yoruba, French…)</option>
              </select>
              <span className="text-xs text-subtle">First use downloads a speech model (~40–150 MB), then it&apos;s cached.</span>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {limits.brandLogo ? (
          <>
            <span className="font-medium">Your logo</span>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of a user file
              <img src={logoUrl} alt="Your logo" className="size-9 rounded-md border border-line object-contain" />
            )}
            <label className="btn btn-secondary btn-sm cursor-pointer">
              {logoUrl ? "Change" : "Upload PNG/JPG"}
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => onLogo(e.currentTarget.files?.[0] ?? null)} />
            </label>
            {logoUrl && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onLogo(null)}>
                Remove
              </button>
            )}
          </>
        ) : (
          <span className="flex items-center gap-2 text-muted">
            <LockIcon size={14} /> Add your own logo to every video with{" "}
            <HardLink href="/pricing" className="text-brand hover:underline">
              Studio
            </HardLink>
          </span>
        )}
        {limits.watermark && (
          <span className="text-muted">
            · Free exports include a small &quot;Made with Anti-Timeout&quot; mark.{" "}
            <HardLink href="/pricing" className="text-brand hover:underline">
              Remove it
            </HardLink>
          </span>
        )}
      </div>
    </fieldset>
  );
}
