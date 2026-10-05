"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { HardLink } from "@/components/hard-link";
import { describeAction, parseCommandLocally, type EditorAction } from "@/lib/assistant/actions";
import { applyActions, needsAnalysis } from "@/lib/assistant/apply";
import { buildSuggestions, type Suggestion } from "@/lib/assistant/suggestions";
import { MAX_REMEMBERED_BYTES, projectStore } from "@/lib/video/project-store";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import type { ClipAnalysis } from "@/lib/video/analysis";
import type { MediaInfo } from "@/lib/video/types";
import type { Range } from "@/lib/video/highlights";
import { canStreamCopy, isUntrimmed, needsDownscale } from "@/lib/video/commands";
import { CancelledError, EngineCrashedError, VideoEngine } from "@/lib/video/engine";
import { chooseMethod, exportParts, exportStitched, type ExportMethod, type ExportResult } from "@/lib/video/export";
import { initialTimeline, timelineReducer, toExportItems } from "@/lib/video/timeline";
import { buildAss, type Word, wordsForOutput } from "@/lib/video/captions";
import { cancelTranscription, migrateSpeech, speechKey, transcribeClip } from "@/lib/video/transcribe";
import { cutsPerMinute, outputPeak } from "@/lib/video/highlights";
import { composeWav } from "@/lib/audio/music";
import { findClipsByScene, findViralClips, overallScore, toSentences, type ViralClip } from "@/lib/assistant/viral";
import { DEFAULT_EXPORT_SETTINGS, ExportSettingsPanel, type ExportSettings } from "./export-settings";
import { StartPanel, type Goal } from "./start-panel";
import { TaskBanner } from "./task-banner";
import { WorkspaceNav } from "./workspace-nav";
import { forgetThumbnails } from "./thumbnails";
import { DEFAULT_MUSIC, type OwnTrack } from "./music-controls";
import { VIRAL_RANGES, ViralPanel, type VideoKind, type ViralRange } from "./viral-panel";
import type { ExportItem } from "@/lib/video/types";
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
/** Longer videos are analysed on demand instead, so a queued export isn't held up. */
/**
 * Videos up to this long get the full analysis (motion and cuts) in the
 * background as soon as they're added, so it's usually done before it's
 * needed; longer ones get the quick sound-only one, and the rest on demand.
 */
const BACKGROUND_ANALYSIS_MAX_SECONDS = 1800;

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
  const backgroundQueue = useRef<Promise<unknown>>(Promise.resolve());
  // Running analyses, with everyone waiting on each so they all see its progress.
  const inflight = useRef(new Map<string, { run: Promise<ClipAnalysis>; listeners: Set<(r: number) => void> }>());
  // Mirrors `analyses` for rendering (suggestions); the ref is for async logic.
  const [analysisState, setAnalysisState] = useState<Record<string, ClipAnalysis>>({});
  const [assistant, setAssistant] = useState<AssistantMessage | null>(null);
  const [history, setHistory] = useState<Range[][]>([]);
  const [restore, setRestore] = useState<{ savedAt: number; videos: number } | null>(null);
  const [memory, setMemory] = useState<"off" | "saved" | "too-large" | "unavailable">("off");
  // True once this session owns the saved project (so an untouched page never overwrites it).
  const persist = useRef(false);
  const storedBytes = useRef(0);
  const [settings, setSettings] = useState<ExportSettings>(() => loadSettings());
  const transcripts = useRef(new Map<string, Word[]>());
  // The speech settings each transcript was made with; changing them means listening again.
  const transcriptKeys = useRef(new Map<string, string>());
  const [task, setTask] = useState<{ label: string; progress: number | null } | null>(null);
  const [viral, setViral] = useState<{ clips: ViralClip[]; basis: "transcript" | "scenes"; improved: boolean; range: ViralRange } | null>(null);
  const [logo, setLogo] = useState<{ url: string; bytes: Uint8Array } | null>(() => loadLogo());
  const fileInput = useRef<HTMLInputElement>(null);
  // The user's own music; kept in memory only (it isn't theirs to store with the project).
  const [ownTrack, setOwnTrack] = useState<OwnTrack | null>(null);
  // Picked on the start screen; runs once the first video has been read.
  const [goal, setGoal] = useState<Goal | null>(null);

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

  // Offer to restore the last project saved on this device.
  useEffect(() => {
    if (!projectStore.available()) return;
    projectStore
      .load()
      .then((saved) => saved && setRestore({ savedAt: saved.project.savedAt, videos: saved.clips.length }))
      .catch(() => {});
  }, []);

  // Remember edits (debounced) so a reload or closed tab doesn't lose work.
  useEffect(() => {
    if (!persist.current) return;
    const timer = setTimeout(() => {
      void projectStore
        .saveProject({
          clipIds: Object.keys(timeline.clips),
          segments: timeline.segments.map(({ clipId, start, end }) => ({ clipId, start, end })),
          mode,
          savedAt: Date.now(),
        })
        .catch(() => setMemory("unavailable"));
    }, 500);
    return () => clearTimeout(timer);
  }, [timeline, mode]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private mode or storage full: settings just won't be remembered.
    }
  }, [settings]);

  const running = exportState.status === "running";
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function rememberAnalysis(id: string, analysis: ClipAnalysis, save = true) {
    // A sound-only result never replaces a full one that finished first.
    if (analysis.level === "audio" && analyses.current.get(id)?.level !== "audio" && analyses.current.has(id)) return;
    analyses.current.set(id, analysis);
    setAnalysisState((prev) => ({ ...prev, [id]: analysis }));
    if (save && persist.current) void projectStore.saveAnalysis(id, analysis).catch(() => {});
  }

  /**
   * The analysis for a clip, measured once. "audio" (sound only) is many times
   * faster and enough for talking videos and silence removal; "full" adds
   * motion and scene cuts, and is reused for audio requests too.
   */
  function getAnalysis(
    id: string,
    info: MediaInfo,
    onProgress?: (r: number) => void,
    level: "audio" | "full" = "full",
    background = false,
  ): Promise<ClipAnalysis> {
    const done = analyses.current.get(id);
    if (done && (level === "audio" || done.level !== "audio")) return Promise.resolve(done);
    // Join a run of the same level. A sound-only request doesn't wait for a
    // full run: its own takes seconds, and the full one runs on helper engines.
    const running = inflight.current.get(`${id}:${level}`);
    if (running) {
      if (onProgress) running.listeners.add(onProgress);
      return running.run;
    }
    const key = `${id}:${level}`;
    const listeners = new Set<(r: number) => void>(onProgress ? [onProgress] : []);
    const run = engine
      .analyze(id, info, (r) => listeners.forEach((l) => l(r)), level, { background })
      .then((a) => {
        rememberAnalysis(id, a);
        return a;
      });
    inflight.current.set(key, { run, listeners });
    void run.catch(() => {}).finally(() => inflight.current.delete(key));
    return run;
  }

  /**
   * Starts measuring a new video right away, on helper engines so the editor
   * stays responsive: the full analysis for videos up to 30 minutes, the
   * sound-only one for longer videos.
   */
  function analyzeInBackground(id: string, info: MediaInfo) {
    const level = info.duration <= BACKGROUND_ANALYSIS_MAX_SECONDS ? "full" : "audio";
    // One video at a time, so adding many at once doesn't start many engines.
    backgroundQueue.current = backgroundQueue.current
      // A removed video fails fast in the engine ("Clip was removed"), which is fine here.
      .then(() => (analyses.current.get(id)?.level === "full" ? undefined : getAnalysis(id, info, undefined, level, true)))
      .catch(() => {});
  }


  function rememberClip(id: string, file: File, info: MediaInfo) {
    if (!projectStore.available()) return setMemory("unavailable");
    if (storedBytes.current + file.size > MAX_REMEMBERED_BYTES) return setMemory("too-large");
    storedBytes.current += file.size;
    persist.current = true;
    void navigator.storage?.persist?.().catch(() => {});
    projectStore
      .saveClip({ id, name: file.name, type: file.type, blob: file, info })
      .then(() => setMemory((m) => (m === "too-large" ? m : "saved")))
      .catch(() => setMemory("unavailable"));
  }

  async function startFresh() {
    setRestore(null);
    await projectStore.clear().catch(() => {});
  }

  async function restoreProject() {
    const saved = await projectStore.load().catch(() => null);
    setRestore(null);
    if (!saved) return;
    persist.current = true;
    setPending(saved.clips.map((c) => c.name));
    for (const stored of saved.clips) {
      const file = new File([stored.blob], stored.name, { type: stored.type });
      try {
        const info = await engine.addClip(stored.id, file);
        dispatch({ type: "addClip", clip: { id: stored.id, file, info, url: URL.createObjectURL(file) } });
        storedBytes.current += file.size;
        if (stored.analysis) rememberAnalysis(stored.id, stored.analysis, false);
        if (stored.transcript) {
          transcripts.current.set(stored.id, stored.transcript);
          transcriptKeys.current.set(stored.id, stored.transcriptKey ?? speechKey(settings.speech));
        } else analyzeInBackground(stored.id, info);
      } catch {
        void engine.removeClip(stored.id).catch(() => {});
      }
    }
    dispatch({ type: "replaceSegments", segments: saved.project.segments });
    setMode(saved.project.mode);
    setPending([]);
    setMemory("saved");
  }

  useEffect(() => {
    if (!goal || timeline.segments.length === 0 || pending.length > 0 || engineStatus !== "ready") return;
    const picked = goal;
    queueMicrotask(() => {
      setGoal(null);
      if (picked === "viral") void findViral(VIRAL_RANGES[0]);
      else if (picked === "highlight") void runActions([{ type: "highlights", seconds: 30 }]);
      else if (picked === "captions") {
        setSettings((s) => ({ ...s, aspect: "9:16", fit: "blur", captions: true }));
        document.getElementById("export")?.scrollIntoView({ behavior: "smooth" });
      }
    });
    // Runs once per goal; the actions read the current render's timeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, timeline.segments.length, pending.length, engineStatus]);

  function pickGoal(picked: Goal | null) {
    setGoal(picked);
    fileInput.current?.click();
  }

  async function addFiles(files: File[]) {
    // Adding new videos while a saved project is on offer means starting fresh.
    if (restore) await startFresh();
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
        rememberClip(id, file, info);
        // Analyse in the background so suggestions appear and auto-edit is instant.
        analyzeInBackground(id, info);
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
      forgetThumbnails(timeline.clips[segment.clipId].url);
      URL.revokeObjectURL(timeline.clips[segment.clipId].url);
      analyses.current.delete(segment.clipId);
      transcripts.current.delete(segment.clipId);
      transcriptKeys.current.delete(segment.clipId);
      setAnalysisState((prev) => {
        const next = { ...prev };
        delete next[segment.clipId];
        return next;
      });
      storedBytes.current = Math.max(0, storedBytes.current - timeline.clips[segment.clipId].file.size);
      void projectStore.deleteClip(segment.clipId).catch(() => {});
      void engine.removeClip(segment.clipId).catch(() => {});
      // Undo snapshots may refer to the removed video; they can't be restored now.
      setHistory([]);
    }
  }

  /** Analyses every clip not yet measured at `level`, with combined progress. */
  async function analyzeClips(clipIds: string[], level: "audio" | "full" = "full") {
    const todo = clipIds.filter((id) => {
      const a = analyses.current.get(id);
      return !a || (level === "full" && a.level === "audio");
    });
    const total = todo.reduce((sum, id) => sum + timeline.clips[id].info.duration, 0);
    let done = 0;
    for (const id of todo) {
      const { info } = timeline.clips[id];
      const report = (r: number) =>
        setAssistant({ kind: "working", text: "Watching your videos for the best parts…", progress: total ? (done + r * info.duration) / total : null });
      report(0);
      await getAnalysis(id, info, report, level);
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
      // Silence removal only needs the sound, which is much faster to measure.
      const level = actions.some((a) => a.type === "highlights") ? "full" : "audio";
      if (needsAnalysis(actions)) await analyzeClips(Object.keys(timeline.clips), level);
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

  async function applySuggestion(s: Suggestion) {
    await runActions(s.actions);
    if (s.mode) setMode(s.mode);
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

  /** Makes sure every listed clip has word timings, transcribing what's missing. */
  async function ensureTranscripts(clipIds: string[]) {
    for (const id of clipIds) {
      const key = speechKey(settings.speech);
      if (transcripts.current.has(id) && transcriptKeys.current.get(id) === key) continue;
      const clip = timeline.clips[id];
      if (!clip) continue;
      const words = await transcribeClip(engine, id, clip.info, settings.speech, (p) =>
        setTask({
          label: p.stage === "download" ? "Downloading the speech model (first time only)…" : `Listening to ${clip.file.name}…`,
          progress: p.progress,
        }),
      );
      transcripts.current.set(id, words);
      transcriptKeys.current.set(id, key);
      if (persist.current) void projectStore.saveTranscript(id, words, key).catch(() => {});
    }
  }

  function cancelTask() {
    cancelTranscription();
    engine.cancel();
    void engine.load().catch(() => setEngineStatus("error"));
    setTask(null);
  }

  async function findViral(range: ViralRange, kind: VideoKind = "auto") {
    const ids = [...new Set(timeline.segments.map((s) => s.clipId))];
    setViral(null);
    try {
      setTask({ label: "Watching your videos…", progress: null });
      // Talking videos are judged on the words and sound: no need to decode the picture.
      const level = kind === "talking" ? "audio" : "full";
      for (const id of ids) {
        await getAnalysis(id, timeline.clips[id].info, (r) => setTask({ label: level === "audio" ? "Listening to your videos…" : "Watching your videos…", progress: r }), level);
      }
      // Heavily edited footage (anime, films, gaming) is judged on its scenes;
      // talking videos (few cuts) on what's said, which needs a transcript.
      const byScenes = (id: string) => {
        const { info } = timeline.clips[id];
        if (kind === "scenes" || !info.audioCodec) return true;
        if (kind === "talking") return false;
        return cutsPerMinute(analyses.current.get(id)!) >= 6;
      };
      let speech = true;
      try {
        await ensureTranscripts(ids.filter((id) => !byScenes(id)));
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        speech = false; // Speech model unavailable (offline, old browser): fall back to scenes.
      }
      setTask({ label: "Scoring moments…", progress: null });
      const opts = { minSeconds: range.min, maxSeconds: range.max, maxClips: 10 };
      let basis: "transcript" | "scenes" = "scenes";
      const found = ids.flatMap((id) => {
        const words = speech && !byScenes(id) ? (transcripts.current.get(id) ?? []) : [];
        const byWords = words.length > 20 ? findViralClips(id, words, analyses.current.get(id), opts) : [];
        if (byWords.length) {
          basis = "transcript";
          return byWords;
        }
        return findClipsByScene(id, timeline.clips[id].info.duration, analyses.current.get(id)!, opts);
      });
      setViral({ clips: found.sort((a, b) => b.score - a.score).slice(0, 10), basis, improved: false, range });
    } catch (err) {
      if (!(err instanceof CancelledError)) setErrors((e) => [...e, "Couldn't analyse the video for viral clips. Please try again."]);
    } finally {
      setTask(null);
    }
  }

  async function improveViral() {
    if (!viral) return;
    // The video with the most speech gets the AI treatment.
    const id = [...new Set(viral.clips.map((c) => c.clipId))].sort(
      (a, b) => (transcripts.current.get(b)?.length ?? 0) - (transcripts.current.get(a)?.length ?? 0),
    )[0];
    const sentences = toSentences(transcripts.current.get(id) ?? []);
    if (sentences.length < 3) {
      setErrors((e) => [...e, "AI needs a video with speech to improve the picks."]);
      return;
    }
    setTask({ label: "AI is reviewing every moment for hooks, curiosity and payoff…", progress: null });
    try {
      const res = await fetch("/api/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentences: sentences.map(({ text, start, end }) => ({ text, start, end })),
          minSeconds: viral.range.min,
          maxSeconds: viral.range.max,
          count: 8,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        clips?: { startSentence: number; endSentence: number; scores: ViralClip["scores"]; reasons: string[]; title: string; caption: string; hashtags: string[] }[];
        error?: string;
      } | null;
      if (!res.ok || !body?.clips) {
        const messages: Record<string, string> = {
          sign_in: "Sign in to improve clips with AI.",
          upgrade: "Improving clips with AI is part of Pro and Studio.",
          limit: "You've used today's AI allowance. The local picks still work.",
          not_configured: "The AI assistant isn't available right now. The local picks still work.",
        };
        setErrors((e) => [...e, messages[body?.error ?? ""] ?? "AI couldn't review this video right now."]);
        return;
      }
      const picks: ViralClip[] = body.clips.map((c, i) => ({
        id: `${id}:ai${i}`,
        clipId: id,
        start: Math.max(0, sentences[c.startSentence].start - 0.15),
        end: sentences[c.endSentence].end + 0.3,
        score: overallScore(c.scores),
        scores: c.scores,
        hook: sentences[c.startSentence].text,
        reasons: c.reasons,
        title: c.title || sentences[c.startSentence].text,
        caption: c.caption,
        hashtags: c.hashtags,
      }));
      const others = viral.clips.filter((c) => c.clipId !== id);
      setViral({ ...viral, clips: [...picks, ...others].sort((a, b) => b.score - a.score).slice(0, 10), improved: true });
    } finally {
      setTask(null);
    }
  }

  function useViralClip(clip: ViralClip) {
    setHistory((h) => [...h.slice(-19), timeline.segments.map(({ clipId, start, end }) => ({ clipId, start, end }))]);
    dispatch({ type: "replaceSegments", segments: [{ clipId: clip.clipId, start: clip.start, end: clip.end }] });
    document.querySelector("[data-testid=segment-list]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function exportViralClips(list: ViralClip[]) {
    const clipItems: ExportItem[] = list.map((c) => ({ clipId: c.clipId, info: timeline.clips[c.clipId].info, start: c.start, end: c.end }));
    void startExport(clipItems, list.length > 1 ? "parts" : "stitch");
    document.getElementById("export")?.scrollIntoView({ behavior: "smooth" });
  }

  async function changeLogo(file: File | null) {
    if (!file) {
      setLogo(null);
      try {
        localStorage.removeItem(LOGO_KEY);
      } catch {}
      return;
    }
    // Normalise to a small PNG (FFmpeg reads it as an overlay input).
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    setLogo(logoFromDataUrl(dataUrl));
    try {
      localStorage.setItem(LOGO_KEY, dataUrl);
    } catch {}
  }

  async function startExport(items = toExportItems(timeline), exportMode: ExportMode = mode) {
    if (exportMode === "stitch" && new Set(items.map((i) => i.clipId)).size > limits.maxStitchClips) {
      setExportState({ status: "error", message: `The ${limits.label} plan stitches up to ${limits.maxStitchClips} videos. Upgrade to Pro for unlimited.` });
      return;
    }
    clearOutputs();
    if (settings.captions) {
      try {
        await ensureTranscripts([...new Set(items.map((i) => i.clipId))]);
      } catch (err) {
        setTask(null);
        if (err instanceof CancelledError) return;
        setExportState({
          status: "error",
          message: "Couldn't create captions (the speech model didn't load). Check your connection, or turn captions off and export again.",
        });
        return;
      } finally {
        setTask(null);
      }
    }
    const music = settings.music;
    const composed = music.style !== "none" && music.style !== "own" ? music.style : null;
    if (composed) {
      // The drop is lined up with the biggest moment, so every clip needs its analysis.
      try {
        for (const id of new Set(items.map((i) => i.clipId))) {
          if (!analyses.current.has(id)) {
            await getAnalysis(id, timeline.clips[id].info, (r) => setTask({ label: "Finding the big moment for the drop…", progress: r }));
          }
        }
      } catch (err) {
        if (err instanceof CancelledError) return;
      } finally {
        setTask(null);
      }
    }
    setExportState({ status: "running", progress: 0 });
    const style = limits.captionStyles === "all" ? settings.captionStyle : "clean";
    const options = {
      maxShortSide: limits.maxShortSide,
      fastCut,
      aspect: settings.aspect,
      fit: settings.fit,
      watermark: limits.watermark,
      logo: limits.brandLogo ? (logo?.bytes ?? null) : null,
      captions:
        settings.captions || settings.hook.on
          ? (renderItems: ExportItem[], canvas: Parameters<typeof buildAss>[2]) => {
              const words = settings.captions
                ? wordsForOutput(renderItems, Object.fromEntries(transcripts.current), limits.captionSeconds)
                : [];
              const hookText = settings.hook.on ? hookFor(renderItems) : null;
              if (!words.length && !hookText) return null;
              return buildAss(words, style, canvas, hookText ? { hook: { text: hookText, seconds: 3 } } : {});
            }
          : undefined,
      progressBar: settings.progressBar,
      music:
        composed || (music.style === "own" && ownTrack)
          ? async (renderItems: ExportItem[], duration: number) => {
              const mix = { volume: music.volume, original: music.original, duck: music.duck };
              if (!composed) return ownTrack ? { ...mix, bytes: ownTrack.bytes, ext: ownTrack.ext } : null;
              const seed = Math.round(renderItems[0].start * 10) + renderItems.length;
              return { ...mix, bytes: await composeWav(composed, duration, outputPeak(renderItems, analyses.current), seed), ext: "wav" };
            }
          : undefined,
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

  /**
   * The hook title for one render: the user's text, or the title of the viral
   * clip being exported (scene clips get their caption, since "Scene 2 · 6:30"
   * isn't a hook). Null when there's nothing to say.
   */
  function hookFor(renderItems: ExportItem[]): string | null {
    // The caption fonts have no emoji, so they'd burn in as empty boxes.
    const plain = (t: string) => t.replace(/\p{Extended_Pictographic}|\uFE0F/gu, "").replace(/\s+/g, " ").trim();
    const custom = plain(settings.hook.text);
    if (custom) return custom;
    const first = renderItems[0];
    const clip = viral?.clips.find((c) => c.clipId === first?.clipId && Math.abs(c.start - first.start) < 0.3);
    if (!clip) return null;
    return plain(viral?.basis === "scenes" ? clip.caption : clip.title) || "Wait for it…";
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
    copyCandidates.map((group) =>
      chooseMethod(group, {
        maxShortSide: limits.maxShortSide,
        fastCut,
        aspect: settings.aspect,
        watermark: limits.watermark,
        logo: limits.brandLogo ? (logo?.bytes ?? null) : null,
        captions: settings.captions || settings.hook.on ? () => null : undefined,
        music: settings.music.style !== "none" ? async () => null : undefined,
        progressBar: settings.progressBar,
      }),
    ),
  );
  const exportDisabled = segments.length === 0 || overClipLimit || running || engineStatus === "error";

  const colors = clipColors(Object.keys(clips));
  const suggestions = buildSuggestions({
    clips: Object.values(clips).map((c) => ({ id: c.id, duration: c.info.duration, width: c.info.width, height: c.info.height })),
    segments,
    analyses: analysisState,
  });
  const analysing = segments.some(
    (s) => !analysisState[s.clipId],
  );

  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
      <WorkspaceNav plan={plan} hasVideos={segments.length > 0} totalBytes={totalBytes} />
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <EngineBadge status={engineStatus} mode={engine.mode} />
          {memory === "saved" && (
            <p className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-muted" data-testid="memory-status">
              ✓ Saved on this device. Pick up where you left off anytime.
            </p>
          )}
          {memory === "too-large" && (
            <p className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-muted">
              This project is too large to remember after you close the tab.
            </p>
          )}
        </div>

        {task && <TaskBanner key={task.label} label={task.label} progress={task.progress} onCancel={cancelTask} />}

        {restore && (
          <div className="card flex flex-wrap items-center justify-between gap-4 border-brand/40 p-5" data-testid="restore">
            <div>
              <p className="font-medium">Welcome back! Continue where you left off?</p>
              <p className="text-sm text-muted">
                Your project from {timeAgo(restore.savedAt)} ({restore.videos} video{restore.videos === 1 ? "" : "s"}) is saved on this
                device.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => void startFresh()}>
                Start fresh
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void restoreProject()} disabled={engineStatus === "error"}>
                Restore project
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInput}
          id="video-input"
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
        <div id="tool-start" className="scroll-mt-32">
          {segments.length === 0 && !restore ? (
            <StartPanel onPick={pickGoal} onDrop={(files) => void addFiles(files)} />
          ) : (
            <label
              htmlFor="video-input"
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
              className={`group flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed p-5 text-center transition-colors sm:flex-row sm:justify-center sm:text-left ${
                dragging ? "border-brand bg-brand/10" : "border-line-strong bg-surface/60 hover:border-brand/60 hover:bg-surface"
              }`}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-brand/12 text-brand transition-transform group-hover:scale-105">
                <UploadIcon size={20} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Add more videos</span>
                <span className="text-sm text-muted">MP4, MOV or WebM. Files stay on your device; nothing is uploaded.</span>
              </span>
            </label>
          )}
        </div>

        {pending.length > 0 && (
          <p className="notice notice-info animate-pulse" role="status">
            Reading {pending.join(", ")}…{goal && goal !== "stitch" ? ` Then ${GOAL_NEXT[goal]}.` : ""}
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
            suggestions={suggestions}
            analysing={analysing}
            onSuggestion={(sg) => void applySuggestion(sg)}
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
          <ViralPanel
            clips={viral?.clips ?? null}
            basis={viral?.basis ?? null}
            busy={Boolean(task) || running || engineStatus !== "ready"}
            exportable={limits.viralClipExports}
            canImprove={plan !== "free"}
            improved={viral?.improved ?? false}
            clipName={(id) => clips[id]?.file.name ?? "video"}
            clipUrl={(id) => clips[id]?.url}
            speech={settings.speech}
            onSpeech={(speech) => setSettings((s) => ({ ...s, speech }))}
            onFind={(range, kind) => void findViral(range, kind)}
            onImprove={() => void improveViral()}
            onUse={useViralClip}
            onExport={exportViralClips}
          />
        )}

        {segments.length > 0 && (
          <div id="tool-timeline" className="flex scroll-mt-32 flex-col gap-6">
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
          </div>
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

            <ExportSettingsPanel
              settings={settings}
              onChange={setSettings}
              limits={limits}
              disabled={running}
              logoUrl={logo?.url ?? null}
              onLogo={(f) => void changeLogo(f)}
              ownTrack={ownTrack}
              onOwnTrack={(file) => {
                if (!file) return setOwnTrack(null);
                void file.arrayBuffer().then((buf) =>
                  setOwnTrack({ name: file.name, bytes: new Uint8Array(buf), ext: (file.name.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3" }),
                );
              }}
            />

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

const SETTINGS_KEY = "anti-timeout:export-settings";
const LOGO_KEY = "anti-timeout:logo";

function loadSettings(): ExportSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as (Partial<ExportSettings> & { language?: unknown }) | null;
    const { language, ...rest } = saved ?? {};
    const music = { ...DEFAULT_MUSIC, ...rest.music };
    // Your own track isn't saved, so it can't be the remembered choice.
    if (music.style === "own") music.style = "none";
    return { ...DEFAULT_EXPORT_SETTINGS, ...rest, speech: migrateSpeech(rest.speech ?? language), music };
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

function logoFromDataUrl(dataUrl: string): { url: string; bytes: Uint8Array } {
  const binary = atob(dataUrl.split(",")[1] ?? "");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return { url: dataUrl, bytes };
}

function loadLogo(): { url: string; bytes: Uint8Array } | null {
  try {
    const dataUrl = localStorage.getItem(LOGO_KEY);
    return dataUrl ? logoFromDataUrl(dataUrl) : null;
  } catch {
    return null;
  }
}

function timeAgo(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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

const GOAL_NEXT: Record<Exclude<Goal, "stitch">, string> = {
  viral: "finding your viral clips",
  highlight: "making a 30s highlight",
  captions: "setting up captions for 9:16",
};
