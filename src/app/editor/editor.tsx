"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { describeAction, parseCommandLocally, type EditorAction } from "@/lib/assistant/actions";
import { applyActions, needsAnalysis } from "@/lib/assistant/apply";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import type { ClipAnalysis } from "@/lib/video/analysis";
import type { Range } from "@/lib/video/highlights";
import { canStreamCopy, isUntrimmed, needsDownscale } from "@/lib/video/commands";
import { CancelledError, EngineCrashedError, VideoEngine } from "@/lib/video/engine";
import { chooseMethod, exportParts, exportStitched, type ExportMethod, type ExportResult } from "@/lib/video/export";
import { initialTimeline, timelineReducer, toExportItems } from "@/lib/video/timeline";
import { DownloadIcon, UploadIcon } from "@/components/icons";
import { AutoEditPanel, type AssistantMessage } from "./auto-edit-panel";
import { clipColors } from "./clip-colors";
import { formatBytes, formatTime } from "./format";
import { Player } from "./player";
import { SegmentList } from "./segment-list";

/** Above this total input size, browsers (especially phones) may run out of memory. */
const LARGE_INPUT_BYTES = 1.5 * 1024 ** 3;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|ts|mts)$/i;
const MAX_LOG_LINES = 200;

type EngineStatus = "loading" | "ready" | "error";
type ExportMode = "stitch" | "parts";
type ExportState =
  | { status: "idle"; message?: string }
  | { status: "running"; progress: number }
  | { status: "done"; outputs: { url: string; name: string; size: number; method: ExportMethod }[] }
  | { status: "error"; message: string };

export function Editor({ plan }: { plan: PlanId }) {
  const limits = PLAN_LIMITS[plan];
  const [engine] = useState(() => new VideoEngine());
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [timeline, dispatch] = useReducer(timelineReducer, initialTimeline);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<ExportMode>("stitch");
  const [fastCut, setFastCut] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [logs, setLogs] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const outputUrls = useRef<string[]>([]);
  const analyses = useRef(new Map<string, ClipAnalysis>());
  const [assistant, setAssistant] = useState<AssistantMessage | null>(null);
  const [history, setHistory] = useState<Range[][]>([]);

  useEffect(() => {
    engine.load().then(
      () => setEngineStatus("ready"),
      () => setEngineStatus("error"),
    );
    const off = engine.onLog((line) => setLogs((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), line]));
    return () => {
      off();
      engine.cancel();
      outputUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [engine]);

  const running = exportState.status === "running";
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function addFiles(files: File[]) {
    for (const file of files) {
      if (!file.type.startsWith("video/") && !VIDEO_EXTENSIONS.test(file.name)) {
        setErrors((e) => [...e, `${file.name}: not a video file.`]);
        continue;
      }
      const id = crypto.randomUUID();
      setPending((p) => [...p, file.name]);
      try {
        const info = await engine.addClip(id, file);
        dispatch({ type: "addClip", clip: { id, file, info, url: URL.createObjectURL(file) } });
      } catch (err) {
        void engine.removeClip(id).catch(() => {});
        if (!(err instanceof CancelledError)) {
          setErrors((e) => [...e, `${file.name}: ${err instanceof Error ? err.message : "couldn't be read."}`]);
        }
      } finally {
        setPending((p) => {
          const i = p.indexOf(file.name);
          return i === -1 ? p : [...p.slice(0, i), ...p.slice(i + 1)];
        });
      }
    }
  }

  function removeSegment(id: string) {
    const segment = timeline.segments.find((s) => s.id === id);
    if (!segment) return;
    const clipStillUsed = timeline.segments.some((s) => s.id !== id && s.clipId === segment.clipId);
    dispatch({ type: "removeSegment", id });
    if (!clipStillUsed) {
      URL.revokeObjectURL(timeline.clips[segment.clipId].url);
      analyses.current.delete(segment.clipId);
      void engine.removeClip(segment.clipId).catch(() => {});
      // Undo snapshots may refer to the removed video; they can't be restored now.
      setHistory([]);
    }
  }

  /** Analyses every clip not seen before (loudness + motion), with combined progress. */
  async function analyzeClips(clipIds: string[]) {
    const todo = clipIds.filter((id) => !analyses.current.has(id));
    const total = todo.reduce((sum, id) => sum + timeline.clips[id].info.duration, 0);
    let done = 0;
    for (const id of todo) {
      const { info } = timeline.clips[id];
      const report = (r: number) =>
        setAssistant({ kind: "working", text: "Watching your videos for the best parts…", progress: total ? (done + r * info.duration) / total : null });
      report(0);
      analyses.current.set(id, await engine.analyze(id, info, report));
      done += info.duration;
    }
  }

  /** Runs editor actions (from the buttons, the local parser or the AI) as one undoable step. */
  async function runActions(actions: EditorAction[], reply?: string) {
    if (actions.length === 0) {
      setAssistant({ kind: "error", text: reply ?? "I couldn't turn that into an edit. Try one of the examples." });
      return;
    }
    const before = timeline.segments.map(({ clipId, start, end }) => ({ clipId, start, end }));
    try {
      if (needsAnalysis(actions)) await analyzeClips(Object.keys(timeline.clips));
      const edits = actions.filter((a) => a.type !== "export");
      const next = edits.length ? applyActions(timeline, edits, analyses.current) : before;
      if (edits.length) {
        setHistory((h) => [...h.slice(-19), before]);
        dispatch({ type: "replaceSegments", segments: next });
      }
      const total = next.reduce((sum, r) => sum + r.end - r.start, 0);
      const summary =
        reply ?? `Done: ${next.length} segment${next.length === 1 ? "" : "s"}, ${formatTime(total)} in total. Review below or export.`;
      setAssistant({ kind: "done", text: summary, steps: actions.map(describeAction) });

      const exportAction = actions.find((a) => a.type === "export");
      if (exportAction?.type === "export") {
        const exportMode = exportAction.mode ?? mode;
        setMode(exportMode);
        void startExport(
          next.map((r) => ({ ...r, info: timeline.clips[r.clipId].info })),
          exportMode,
        );
      }
    } catch (err) {
      setAssistant(
        err instanceof CancelledError
          ? { kind: "error", text: "Stopped." }
          : { kind: "error", text: "Something went wrong while analysing. Please try again." },
      );
    }
  }

  async function runCommand(text: string) {
    const local = parseCommandLocally(text);
    if (local) return runActions(local);

    setAssistant({ kind: "working", text: "Thinking…", progress: null });
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: text,
        timeline: {
          clips: Object.values(timeline.clips).map((c) => ({ name: c.file.name, duration: c.info.duration })),
          segments: timeline.segments.map((s) => ({ clip: timeline.clips[s.clipId].file.name, start: s.start, end: s.end })),
        },
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as
      | { reply?: string; actions?: EditorAction[]; error?: string; message?: string; limit?: number }
      | null;

    if (res?.ok && body?.actions) return runActions(body.actions, body.reply);
    const tips = 'Try "make a 30 second highlight", "remove silent parts" or "split into 15s parts".';
    if (res?.status === 401) {
      setAssistant({ kind: "error", text: `Sign in to use the AI assistant for custom requests. ${tips}`, link: { href: "/login?next=/editor", label: "Sign in" } });
    } else if (res?.status === 429) {
      setAssistant({ kind: "error", text: `You've used today's ${body?.limit ?? ""} AI requests. Simple commands still work. ${tips}` });
    } else if (body?.error === "assistant" && body.message) {
      setAssistant({ kind: "error", text: body.message });
    } else {
      setAssistant({ kind: "error", text: `I didn't catch that, and the AI assistant isn't available right now. ${tips}` });
    }
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    dispatch({ type: "replaceSegments", segments: previous });
    setAssistant(null);
  }

  function clearOutputs() {
    outputUrls.current.forEach((url) => URL.revokeObjectURL(url));
    outputUrls.current = [];
  }

  async function startExport(items = toExportItems(timeline), exportMode: ExportMode = mode) {
    if (exportMode === "stitch" && new Set(items.map((i) => i.clipId)).size > limits.maxStitchClips) {
      setExportState({ status: "error", message: `The ${limits.label} plan stitches up to ${limits.maxStitchClips} videos. Upgrade to Pro for unlimited.` });
      return;
    }
    clearOutputs();
    setExportState({ status: "running", progress: 0 });
    const options = {
      maxShortSide: limits.maxShortSide,
      fastCut,
      onProgress: (progress: number) => setExportState({ status: "running", progress }),
    };
    try {
      const results: ExportResult[] =
        exportMode === "stitch" ? [await exportStitched(engine, items, options)] : await exportParts(engine, items, options);
      const outputs = results.map((r) => {
        const url = URL.createObjectURL(r.blob);
        outputUrls.current.push(url);
        return { url, name: r.name, size: r.blob.size, method: r.method };
      });
      setExportState({ status: "done", outputs });
    } catch (err) {
      if (err instanceof CancelledError) {
        setExportState({ status: "idle", message: "Export cancelled." });
      } else {
        setExportState({
          status: "error",
          message:
            err instanceof EngineCrashedError
              ? "The video engine crashed or ran out of memory, so it has been restarted. Try again, or export fewer or shorter clips at a time."
              : "Export failed. Open the FFmpeg log below for details.",
        });
      }
    }
  }

  function cancelExport() {
    engine.cancel();
    // Warm the engine back up so the next action doesn't wait for a reload.
    void engine.load().catch(() => setEngineStatus("error"));
  }

  const { clips, segments, selectedId } = timeline;
  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const items = toExportItems(timeline);
  const totalBytes = Object.values(clips).reduce((sum, c) => sum + c.file.size, 0);
  const totalDuration = items.reduce((sum, i) => sum + (i.end - i.start), 0);
  const videosInUse = new Set(segments.map((s) => s.clipId)).size;
  const overClipLimit = mode === "stitch" && videosInUse > limits.maxStitchClips;
  const downscaled = items.some((i) => needsDownscale(i.info, limits.maxShortSide));
  const copyCandidates = mode === "stitch" ? [items] : items.map((i) => [i]);
  const fastCutAvailable = copyCandidates.some(
    (group) => canStreamCopy(group, limits.maxShortSide) && !group.every(isUntrimmed),
  );
  const methods = new Set(
    copyCandidates.map((group) => chooseMethod(group, { maxShortSide: limits.maxShortSide, fastCut })),
  );
  const exportDisabled = segments.length === 0 || overClipLimit || running || engineStatus === "error";

  const colors = clipColors(Object.keys(clips));

  return (
    <div className="flex flex-col gap-6">
      <EngineBadge status={engineStatus} mode={engine.mode} />

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
        className={`group flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed text-center transition-colors ${
          segments.length > 0 ? "p-5 sm:flex-row sm:justify-center sm:text-left" : "p-10 sm:p-14"
        } ${dragging ? "border-brand bg-brand/10" : "border-line-strong bg-surface/60 hover:border-brand/60 hover:bg-surface"}`}
      >
        <span className="grid size-11 place-items-center rounded-xl bg-brand/12 text-brand transition-transform group-hover:scale-105">
          <UploadIcon size={20} />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{segments.length > 0 ? "Add more videos" : "Drop videos here or click to choose"}</span>
          <span className="text-sm text-muted">MP4, MOV or WebM. Files stay on your device; nothing is uploaded.</span>
        </span>
        <input
          type="file"
          accept="video/*"
          multiple
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            void addFiles([...(e.currentTarget.files ?? [])]);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {pending.length > 0 && (
        <p className="notice notice-info animate-pulse" role="status">
          Reading {pending.join(", ")}…
        </p>
      )}
      {errors.length > 0 && (
        <div className="notice notice-danger flex items-start justify-between gap-3" role="alert">
          <div>
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
          <button type="button" className="shrink-0 underline" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      )}
      {totalBytes > LARGE_INPUT_BYTES && (
        <p className="notice notice-warn">
          You&apos;ve added {formatBytes(totalBytes)} of video. Large exports can crash the tab, especially on phones. If
          that happens, export in smaller batches.
        </p>
      )}

      {segments.length > 0 && (
        <AutoEditPanel
          disabled={engineStatus !== "ready" || running}
          message={assistant}
          canUndo={history.length > 0}
          onHighlights={(seconds) => void runActions([{ type: "highlights", seconds }])}
          onRemoveSilence={() => void runActions([{ type: "remove_silence" }])}
          onCommand={(text) => void runCommand(text)}
          onUndo={undo}
          onExport={() => {
            void startExport();
            document.getElementById("export")?.scrollIntoView({ behavior: "smooth" });
          }}
          onCancel={() => {
            engine.cancel();
            void engine.load().catch(() => setEngineStatus("error"));
          }}
        />
      )}

      {segments.length > 0 && (
        <>
          <Timeline
            segments={segments}
            colors={colors}
            selectedId={selectedId}
            total={totalDuration}
            onSelect={(id) => dispatch({ type: "select", id })}
          />
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div>
              {selected && (
                <Player
                  key={selected.clipId}
                  clip={clips[selected.clipId]}
                  segment={selected}
                  onSetStart={(start) => dispatch({ type: "setRange", id: selected.id, start })}
                  onSetEnd={(end) => dispatch({ type: "setRange", id: selected.id, end })}
                  onSplit={(at) => dispatch({ type: "split", id: selected.id, at })}
                  onSplitEvery={(seconds) => dispatch({ type: "splitEvery", id: selected.id, seconds })}
                />
              )}
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="flex items-center justify-between text-sm font-medium text-muted">
                Segments
                <span className="font-mono text-xs text-subtle">
                  {segments.length} · {formatTime(totalDuration)}
                </span>
              </h2>
              <SegmentList
                segments={segments}
                clips={clips}
                colors={colors}
                selectedId={selectedId}
                onSelect={(id) => dispatch({ type: "select", id })}
                onMove={(id, delta) => dispatch({ type: "move", id, delta })}
                onRemove={removeSegment}
                onSetRange={(id, range) => dispatch({ type: "setRange", id, ...range })}
              />
            </div>
          </div>
        </>
      )}

      {segments.length > 0 && (
        <section id="export" className="card flex scroll-mt-24 flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Export</h2>
            <span className="badge">
              {methods.size === 1 && methods.has("copy")
                ? "Fast join · no re-encode"
                : methods.has("copy")
                  ? "Mix of fast copy and re-encode"
                  : "Re-encode · frame-accurate"}
            </span>
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={running}>
            <legend className="sr-only">Export mode</legend>
            <ModeOption
              checked={mode === "stitch"}
              onChange={() => setMode("stitch")}
              title="Stitch into one video"
              body="Join every segment, in order, into a single MP4."
            />
            <ModeOption
              checked={mode === "parts"}
              onChange={() => setMode("parts")}
              title="Save each segment as its own file"
              body="One MP4 per segment. Great after splitting into parts."
            />
          </fieldset>

          {fastCutAvailable && (
            <label className="flex items-start gap-3 text-sm text-muted">
              <input
                type="checkbox"
                checked={fastCut}
                disabled={running}
                onChange={(e) => setFastCut(e.target.checked)}
                className="mt-1 accent-brand"
              />
              <span>
                <span className="text-fg">Fast cut</span> (no re-encode, no quality loss). Cuts snap to the nearest
                keyframe, so they can be off by up to a couple of seconds.
              </span>
            </label>
          )}

          {downscaled && (
            <p className="text-sm text-muted">
              {limits.label} exports are capped at {limits.maxShortSide}p.{" "}
              <HardLink href="/pricing" className="text-brand hover:underline">
                Go Pro for full resolution
              </HardLink>
            </p>
          )}

          {overClipLimit && (
            <p className="notice notice-warn" data-testid="clip-limit">
              The {limits.label} plan stitches up to {limits.maxStitchClips} different videos (you&apos;re using{" "}
              {videosInUse}). Remove some, or{" "}
              <HardLink href="/pricing" className="font-medium underline">
                upgrade to Pro
              </HardLink>{" "}
              for unlimited stitching.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void startExport()} disabled={exportDisabled} className="btn btn-primary btn-lg">
              {engineStatus === "loading" && !running ? "Loading engine…" : running ? "Exporting…" : "Export"}
            </button>
            {running && (
              <>
                <div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-300"
                    style={{ width: `${Math.round(exportState.progress * 100)}%` }}
                  />
                </div>
                <progress className="sr-only" value={exportState.progress} max={1} />
                <span className="w-12 text-right font-mono text-sm">{Math.round(exportState.progress * 100)}%</span>
                <button type="button" onClick={cancelExport} className="btn btn-ghost">
                  Cancel
                </button>
              </>
            )}
          </div>

          {exportState.status === "idle" && exportState.message && (
            <p className="text-sm text-muted">{exportState.message}</p>
          )}
          {exportState.status === "error" && (
            <p className="notice notice-danger" role="alert">
              {exportState.message}
            </p>
          )}
          {exportState.status === "done" && <Outputs outputs={exportState.outputs} />}
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-subtle hover:text-muted">FFmpeg log</summary>
        <pre
          className="mt-2 max-h-64 overflow-auto rounded-xl border border-line bg-surface p-3 font-mono text-xs text-muted"
          data-testid="ffmpeg-log"
        >
          {logs.join("\n") || "No output yet."}
        </pre>
      </details>
    </div>
  );
}

function ModeOption({ checked, onChange, title, body }: { checked: boolean; onChange: () => void; title: string; body: string }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
        checked ? "border-brand/60 bg-brand/[0.07]" : "border-line hover:border-line-strong"
      }`}
    >
      <input type="radio" name="mode" checked={checked} onChange={onChange} className="mt-1 accent-brand" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted">{body}</span>
      </span>
    </label>
  );
}

/** Proportional strip of segments; click one to select it. */
function Timeline({
  segments,
  colors,
  selectedId,
  total,
  onSelect,
}: {
  segments: { id: string; clipId: string; start: number; end: number }[];
  colors: Record<string, string>;
  selectedId: string | null;
  total: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card flex h-16 gap-1 p-1.5" aria-label="Timeline">
      {segments.map((s, i) => {
        const selected = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            title={`Segment ${i + 1} · ${formatTime(s.end - s.start)}`}
            className={`relative min-w-3 overflow-hidden rounded-lg transition-[opacity,box-shadow] ${
              selected ? "opacity-100 ring-2 ring-white" : "opacity-70 hover:opacity-100"
            }`}
            style={{ flexGrow: Math.max(s.end - s.start, total / 100), flexBasis: 0, background: colors[s.clipId] }}
          >
            <span className="absolute bottom-1 left-1.5 font-mono text-[10px] font-medium text-black/60">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

function EngineBadge({ status, mode }: { status: EngineStatus; mode: VideoEngine["mode"] }) {
  const fast = mode === "multi-threaded";
  const text =
    status === "loading"
      ? "Loading video engine (about 30 MB, cached after the first visit)…"
      : status === "error"
        ? "The video engine failed to load. Check your connection and reload the page."
        : fast
          ? "Video engine ready · multi-threaded"
          : "Video engine ready · single-threaded (exports will be slower in this browser)";
  const dot = status === "error" ? "bg-danger" : status === "loading" ? "bg-warn animate-pulse" : fast ? "bg-ok" : "bg-warn";

  return (
    <p
      data-testid="engine-status"
      data-status={status}
      data-mode={mode}
      className="flex items-center gap-2.5 self-start rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-muted"
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {text}
    </p>
  );
}

function Outputs({ outputs }: { outputs: { url: string; name: string; size: number; method: ExportMethod }[] }) {
  const single = outputs.length === 1;
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-5" data-testid="outputs">
      <p className="notice notice-ok">
        {single ? "Your video is ready." : `${outputs.length} files are ready.`} Download before leaving this page.
      </p>
      {single && <video src={outputs[0].url} controls playsInline className="aspect-video w-full rounded-xl bg-black" />}
      <ul className="flex flex-col gap-2">
        {outputs.map((o) => (
          <li key={o.url} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm">
            <span className="truncate font-mono">{o.name}</span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-subtle">{formatBytes(o.size)}</span>
              <a href={o.url} download={o.name} className="btn btn-secondary btn-sm">
                <DownloadIcon size={15} /> Download {o.name}
              </a>
            </span>
          </li>
        ))}
      </ul>
      {!single && (
        <button
          type="button"
          className="btn btn-primary self-start"
          onClick={() => {
            // Browsers may ask once for permission to download multiple files.
            outputs.forEach((o, i) =>
              setTimeout(() => {
                const a = document.createElement("a");
                a.href = o.url;
                a.download = o.name;
                a.click();
              }, i * 300),
            );
          }}
        >
          <DownloadIcon size={16} /> Download all ({outputs.length})
        </button>
      )}
    </div>
  );
}
