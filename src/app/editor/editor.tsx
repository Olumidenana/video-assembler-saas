"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { canStreamCopy, isUntrimmed, needsDownscale } from "@/lib/video/commands";
import { CancelledError, EngineCrashedError, VideoEngine } from "@/lib/video/engine";
import { chooseMethod, exportParts, exportStitched, type ExportMethod, type ExportResult } from "@/lib/video/export";
import { initialTimeline, timelineReducer, toExportItems } from "@/lib/video/timeline";
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
      void engine.removeClip(segment.clipId).catch(() => {});
    }
  }

  function clearOutputs() {
    outputUrls.current.forEach((url) => URL.revokeObjectURL(url));
    outputUrls.current = [];
  }

  async function startExport() {
    clearOutputs();
    setExportState({ status: "running", progress: 0 });
    const items = toExportItems(timeline);
    const options = {
      maxShortSide: limits.maxShortSide,
      fastCut,
      onProgress: (progress: number) => setExportState({ status: "running", progress }),
    };
    try {
      const results: ExportResult[] =
        mode === "stitch" ? [await exportStitched(engine, items, options)] : await exportParts(engine, items, options);
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
  const overClipLimit = mode === "stitch" && segments.length > limits.maxStitchSegments;
  const downscaled = items.some((i) => needsDownscale(i.info, limits.maxShortSide));
  const copyCandidates = mode === "stitch" ? [items] : items.map((i) => [i]);
  const fastCutAvailable = copyCandidates.some(
    (group) => canStreamCopy(group, limits.maxShortSide) && !group.every(isUntrimmed),
  );
  const methods = new Set(
    copyCandidates.map((group) => chooseMethod(group, { maxShortSide: limits.maxShortSide, fastCut })),
  );
  const exportDisabled = segments.length === 0 || overClipLimit || running || engineStatus === "error";

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
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-8 text-center ${
          dragging ? "border-foreground/60 bg-foreground/5" : "border-foreground/20"
        }`}
      >
        <span className="font-medium">Drop videos here or click to choose</span>
        <span className="text-sm text-foreground/60">
          MP4, MOV or WebM. Files stay on your device; nothing is uploaded.
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
        <p className="text-sm text-foreground/70" role="status">
          Reading {pending.join(", ")}…
        </p>
      )}
      {errors.length > 0 && (
        <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400" role="alert">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
          <button type="button" className="mt-1 underline" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      )}
      {totalBytes > LARGE_INPUT_BYTES && (
        <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          You&apos;ve added {formatBytes(totalBytes)} of video. Large exports can crash the tab, especially on
          phones. If that happens, export in smaller batches.
        </p>
      )}

      {segments.length > 0 && (
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
          <SegmentList
            segments={segments}
            clips={clips}
            selectedId={selectedId}
            onSelect={(id) => dispatch({ type: "select", id })}
            onMove={(id, delta) => dispatch({ type: "move", id, delta })}
            onRemove={removeSegment}
            onSetRange={(id, range) => dispatch({ type: "setRange", id, ...range })}
          />
        </div>
      )}

      {segments.length > 0 && (
        <section className="flex flex-col gap-4 rounded-xl border border-foreground/15 p-4">
          <h2 className="font-semibold">Export</h2>

          <fieldset className="flex flex-wrap gap-4 text-sm" disabled={running}>
            <legend className="sr-only">Export mode</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" checked={mode === "stitch"} onChange={() => setMode("stitch")} />
              Stitch into one video
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" checked={mode === "parts"} onChange={() => setMode("parts")} />
              Save each segment as its own file
            </label>
          </fieldset>

          {fastCutAvailable && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={fastCut} disabled={running} onChange={(e) => setFastCut(e.target.checked)} className="mt-1" />
              <span>
                Fast cut (no re-encode, no quality loss). Cuts snap to the nearest keyframe, so they can be off by
                up to a couple of seconds.
              </span>
            </label>
          )}

          <ul className="flex flex-col gap-1 text-sm text-foreground/70">
            <li>
              {segments.length} segment{segments.length === 1 ? "" : "s"}, {formatTime(totalDuration)} total ·{" "}
              {methods.size === 1 && methods.has("copy")
                ? "fast join (no re-encode)"
                : methods.has("copy")
                  ? "mix of fast copy and re-encode"
                  : "re-encode (frame-accurate)"}
            </li>
            {downscaled && (
              <li>
                {limits.label} exports are capped at {limits.maxShortSide}p.{" "}
                <HardLink href="/pricing" className="underline">
                  Go Pro for full resolution
                </HardLink>
                .
              </li>
            )}
          </ul>

          {overClipLimit && (
            <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400" data-testid="clip-limit">
              The {limits.label} plan stitches up to {limits.maxStitchSegments} segments. Remove{" "}
              {segments.length - limits.maxStitchSegments}, or{" "}
              <HardLink href="/pricing" className="font-medium underline">
                upgrade to Pro
              </HardLink>{" "}
              for unlimited stitching.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={startExport}
              disabled={exportDisabled}
              className="rounded-md bg-foreground px-5 py-2.5 font-medium text-background disabled:opacity-40"
            >
              {engineStatus === "loading" && !running ? "Loading engine…" : "Export"}
            </button>
            {running && (
              <>
                <progress className="h-2 flex-1" value={exportState.progress} max={1} />
                <span className="w-12 text-right font-mono text-sm">{Math.round(exportState.progress * 100)}%</span>
                <button type="button" onClick={cancelExport} className="rounded-md border border-foreground/20 px-3 py-2 text-sm">
                  Cancel
                </button>
              </>
            )}
          </div>

          {exportState.status === "idle" && exportState.message && (
            <p className="text-sm text-foreground/70">{exportState.message}</p>
          )}
          {exportState.status === "error" && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {exportState.message}
            </p>
          )}
          {exportState.status === "done" && <Outputs outputs={exportState.outputs} />}
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-foreground/60">FFmpeg log</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-foreground/5 p-3 text-xs" data-testid="ffmpeg-log">
          {logs.join("\n") || "No output yet."}
        </pre>
      </details>
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
          ? "Video engine ready (multi-threaded)."
          : "Video engine ready in single-threaded mode. Exports will be slower in this browser.";
  const tone =
    status === "error"
      ? "bg-red-500/10 text-red-700 dark:text-red-400"
      : status === "ready" && !fast
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-foreground/5 text-foreground/80";

  return (
    <p data-testid="engine-status" data-status={status} data-mode={mode} className={`rounded-md px-3 py-2 text-sm ${tone}`}>
      {text}
    </p>
  );
}

function Outputs({ outputs }: { outputs: { url: string; name: string; size: number; method: ExportMethod }[] }) {
  const single = outputs.length === 1;
  return (
    <div className="flex flex-col gap-3" data-testid="outputs">
      {single && <video src={outputs[0].url} controls playsInline className="aspect-video w-full rounded-lg bg-black" />}
      <ul className="flex flex-col gap-1 text-sm">
        {outputs.map((o) => (
          <li key={o.url} className="flex flex-wrap items-center gap-2">
            <a href={o.url} download={o.name} className="font-medium underline">
              Download {o.name}
            </a>
            <span className="text-foreground/60">{formatBytes(o.size)}</span>
          </li>
        ))}
      </ul>
      {!single && (
        <button
          type="button"
          className="self-start rounded-md border border-foreground/20 px-3 py-1.5 text-sm"
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
          Download all ({outputs.length})
        </button>
      )}
    </div>
  );
}
