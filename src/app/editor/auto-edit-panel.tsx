"use client";

import { useState } from "react";
import { ArrowRightIcon, SparkIcon } from "@/components/icons";
import type { Suggestion } from "@/lib/assistant/suggestions";

export type AssistantMessage =
  | { kind: "working"; text: string; progress: number | null }
  | { kind: "done"; text: string; steps: string[] }
  | { kind: "error"; text: string; link?: { href: string; label: string } };

interface AutoEditPanelProps {
  disabled: boolean;
  message: AssistantMessage | null;
  canUndo: boolean;
  suggestions: Suggestion[];
  /** Videos are still being analysed in the background. */
  analysing: boolean;
  onSuggestion: (s: Suggestion) => void;
  onHighlights: (seconds: number | null) => void;
  onRemoveSilence: () => void;
  onCommand: (text: string) => void;
  onUndo: () => void;
  onExport: () => void;
  onCancel: () => void;
}

const LENGTHS: { label: string; seconds: number | null }[] = [
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "60s", seconds: 60 },
  { label: "Auto", seconds: null },
];

const EXAMPLES = [
  "Make a 30 second highlight",
  "Remove silent parts",
  "Split into 30s parts for WhatsApp Status",
  "Cut the first 3 seconds",
];

export function AutoEditPanel(props: AutoEditPanelProps) {
  const { disabled, message, canUndo } = props;
  const [length, setLength] = useState<number | null>(30);
  const [command, setCommand] = useState("");
  const working = message?.kind === "working";
  const locked = disabled || working;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand/60 via-brand-2/30 to-transparent p-px" data-testid="auto-edit">
      <div className="relative flex flex-col gap-5 rounded-2xl bg-surface p-5 sm:p-6">
        <div className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full bg-brand/20 blur-3xl animate-drift" />

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-brand/30">
              <SparkIcon size={20} />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Auto-edit</h2>
              <p className="text-sm text-muted">Let the editor find the good parts, or just tell it what you want.</p>
            </div>
          </div>
          {canUndo && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={props.onUndo} disabled={working}>
              Undo last auto-edit
            </button>
          )}
        </div>

        {(props.suggestions.length > 0 || props.analysing) && (
          <div className="relative flex flex-col gap-2" data-testid="suggestions">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Suggested for your video</p>
            {props.suggestions.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {props.suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={locked}
                    onClick={() => props.onSuggestion(s)}
                    className="group flex flex-col gap-1 rounded-xl border border-brand/30 bg-brand/[0.07] p-3 text-left transition-colors hover:border-brand/70 hover:bg-brand/[0.12] disabled:opacity-40"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <SparkIcon size={14} className="text-brand" /> {s.label}
                    </span>
                    <span className="text-xs text-muted">{s.detail}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="size-2 animate-pulse rounded-full bg-brand" /> Looking through your videos for ideas…
              </p>
            )}
          </div>
        )}

        <div className="relative grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg/60 p-4">
            <p className="text-sm font-medium">Best moments</p>
            <p className="text-xs text-muted">Keeps the loudest, most active parts: speech, reactions, music, movement.</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Highlight length">
                {LENGTHS.map((l) => (
                  <button
                    key={l.label}
                    type="button"
                    role="radio"
                    aria-checked={length === l.seconds}
                    onClick={() => setLength(l.seconds)}
                    className={`rounded-md px-3 py-1 text-sm transition-colors ${
                      length === l.seconds ? "bg-brand text-white" : "text-muted hover:text-fg"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={locked} onClick={() => props.onHighlights(length)}>
                Find best moments
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg/60 p-4">
            <p className="text-sm font-medium">Remove silences</p>
            <p className="text-xs text-muted">Cuts out pauses and dead air. Great for talking-head videos and voice notes.</p>
            <button type="button" className="btn btn-secondary btn-sm self-start" disabled={locked} onClick={props.onRemoveSilence}>
              Remove silent parts
            </button>
          </div>
        </div>

        <form
          className="relative flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) props.onCommand(command.trim());
          }}
        >
          <label htmlFor="ai-command" className="text-sm font-medium">
            Or tell it what to do
          </label>
          <div className="flex gap-2">
            <input
              id="ai-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. make a 45 second highlight and put the second video first"
              className="input h-11 flex-1 text-sm"
              maxLength={500}
              disabled={locked}
            />
            <button type="submit" className="btn btn-primary h-11" disabled={locked || !command.trim()} aria-label="Run command">
              <ArrowRightIcon />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={locked}
                onClick={() => {
                  setCommand(ex);
                  props.onCommand(ex);
                }}
                className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-brand/60 hover:text-fg disabled:opacity-40"
              >
                {ex}
              </button>
            ))}
          </div>
        </form>

        {message && <Status message={message} onExport={props.onExport} onCancel={props.onCancel} />}
      </div>
    </section>
  );
}

function Status({ message, onExport, onCancel }: { message: AssistantMessage; onExport: () => void; onCancel: () => void }) {
  if (message.kind === "working") {
    return (
      <div className="relative flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/[0.06] p-4" role="status" data-testid="assistant-status">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-brand" />
            {message.text}
          </span>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          {message.progress === null ? (
            <div className="h-full w-1/3 animate-indeterminate rounded-full bg-gradient-to-r from-brand to-brand-2" />
          ) : (
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-300"
              style={{ width: `${Math.round(message.progress * 100)}%` }}
            />
          )}
        </div>
      </div>
    );
  }
  if (message.kind === "error") {
    return (
      <p className="notice notice-warn relative" role="alert" data-testid="assistant-status">
        {message.text}{" "}
        {message.link && (
          <a href={message.link.href} className="font-medium underline">
            {message.link.label}
          </a>
        )}
      </p>
    );
  }
  return (
    <div className="notice notice-ok relative flex flex-wrap items-center justify-between gap-3" role="status" data-testid="assistant-status">
      <div className="flex flex-col gap-1">
        <p>{message.text}</p>
        {message.steps.length > 1 && <p className="text-xs opacity-80">{message.steps.join(" → ")}</p>}
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={onExport}>
        Export now
      </button>
    </div>
  );
}
