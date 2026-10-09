"use client";

import { HardLink } from "@/components/hard-link";
import { LockIcon } from "@/components/icons";
import type { PlanLimits } from "@/lib/plans";
import { CAPTION_STYLES, type CaptionStyleId } from "@/lib/video/captions";
import type { Aspect, Fit } from "@/lib/video/commands";
import { DEFAULT_MUSIC, MusicControls, type MusicSettings, type OwnTrack } from "./music-controls";
import { DEFAULT_SPEECH, SPEECH_LANGUAGES, type SpeechOptions } from "@/lib/video/transcribe";

export interface ExportSettings {
  aspect: Aspect;
  fit: Fit;
  captions: boolean;
  captionStyle: CaptionStyleId;
  speech: SpeechOptions;
  music: MusicSettings;
  /** Big title over the first seconds; empty text = the viral clip's title. */
  hook: { on: boolean; text: string };
  progressBar: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  aspect: "original",
  fit: "blur",
  captions: false,
  captionStyle: "clean",
  speech: DEFAULT_SPEECH,
  music: DEFAULT_MUSIC,
  hook: { on: false, text: "" },
  progressBar: false,
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
  ownTrack: OwnTrack | null;
  onOwnTrack: (file: File | null) => void;
  activeTab?: string;
}

export function ExportSettingsPanel({ settings, onChange, limits, disabled, logoUrl, onLogo, ownTrack, onOwnTrack, activeTab }: Props) {
  const set = (patch: Partial<ExportSettings>) => onChange({ ...settings, ...patch });
  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
      active ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong"
    }`;

  const showBrand = !activeTab || activeTab === "export" || activeTab === "tool-brand";
  const showCaptions = !activeTab || activeTab === "export" || activeTab === "tool-captions";
  const showMusic = !activeTab || activeTab === "export" || activeTab === "tool-music";

  return (
    <fieldset className="flex flex-col gap-5" disabled={disabled} data-testid="export-settings">
      <div id="tool-brand" className={showBrand ? "flex scroll-mt-32 flex-col gap-2" : "hidden"}>
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
            {(["blur", "crop", "track"] as const).map((f) =>
              f === "track" && !limits.faceTrack ? (
                <HardLink key={f} href="/pricing" className={`${chip(false)} flex items-center gap-1 py-1`}>
                  <LockIcon size={11} /> Follow the speaker
                </HardLink>
              ) : (
                <button key={f} type="button" className={`${chip(settings.fit === f)} py-1`} onClick={() => set({ fit: f })} aria-pressed={settings.fit === f}>
                  {f === "blur" ? "Fit with blurred background" : f === "crop" ? "Crop to fill" : "Follow the speaker"}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div id="tool-captions" className={showCaptions ? "flex scroll-mt-32 flex-col gap-2" : "hidden"}>
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
            <SpeechControls speech={settings.speech} onChange={(speech) => set({ speech })} />
          </>
        )}
      </div>

      <div className={showBrand ? "flex flex-col gap-2" : "hidden"} data-testid="boosters">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">Retention boosters</span>
          <span className="text-xs text-muted">Tricks that keep people watching past the first seconds.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.hook.on}
              onChange={(e) => set({ hook: { ...settings.hook, on: e.target.checked } })}
              className="accent-brand"
            />
            Hook title for the first 3 seconds
          </label>
          {settings.hook.on && (
            <input
              value={settings.hook.text}
              onChange={(e) => set({ hook: { ...settings.hook, text: e.target.value.slice(0, 80) } })}
              placeholder="Auto: the viral clip's title, or type one"
              className="input h-8 min-w-0 flex-1 basis-56"
              aria-label="Hook text"
            />
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.progressBar} onChange={(e) => set({ progressBar: e.target.checked })} className="accent-brand" />
          Progress bar along the bottom
        </label>
      </div>

      <div id="tool-music" className={showMusic ? "scroll-mt-32" : "hidden"}>
        <MusicControls music={settings.music} onChange={(music) => set({ music })} ownTrack={ownTrack} onOwnTrack={onOwnTrack} />
      </div>

      <div className={showBrand ? "flex flex-wrap items-center gap-3 text-sm" : "hidden"}>
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

/** Language, translation and accuracy for captions (and for the Viral Clip Finder's transcript). */
export function SpeechControls({ speech, onChange }: { speech: SpeechOptions; onChange: (s: SpeechOptions) => void }) {
  const set = (patch: Partial<SpeechOptions>) => onChange({ ...speech, ...patch });
  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      <div className="flex flex-wrap items-center gap-2">
        Spoken language:
        <select value={speech.language} onChange={(e) => set({ language: e.target.value })} className="input h-8" aria-label="Spoken language">
          {SPEECH_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
          <option disabled>…and ~80 more with “Detect automatically”</option>
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={speech.translate} onChange={(e) => set({ translate: e.target.checked })} className="accent-brand" />
          Translate captions to English
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        Accuracy:
        {(["standard", "high"] as const).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => set({ quality: q })}
            aria-pressed={speech.quality === q}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${speech.quality === q ? "border-brand/60 bg-brand/[0.08] text-fg" : "border-line hover:border-line-strong"}`}
          >
            {q === "standard" ? "Standard (~40–80 MB)" : "High (~80–250 MB, best for accents & non-English)"}
          </button>
        ))}
      </div>
      <span className="text-xs text-subtle">The speech model downloads once, then it&apos;s cached. Everything runs on your device.</span>
    </div>
  );
}
