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
import { canStreamCopy, computeCanvas, isUntrimmed, needsDownscale } from "@/lib/video/commands";
import { CancelledError, EngineCrashedError, VideoEngine } from "@/lib/video/engine";
import { chooseMethod, exportParts, exportStitched, type ExportMethod, type ExportResult } from "@/lib/video/export";
import { initialTimeline, timelineReducer, toExportItems } from "@/lib/video/timeline";
import { buildAss, type Word, wordsForOutput } from "@/lib/video/captions";
import { cancelTranscription, migrateSpeech, speechKey, transcribeClip } from "@/lib/video/transcribe";
import { cutsPerMinute, outputPeak } from "@/lib/video/highlights";
import { composeWav, type MusicStyle } from "@/lib/audio/music";
import { findClipsByScene, findViralClips, overallScore, toSentences, type ViralClip } from "@/lib/assistant/viral";
import { DEFAULT_EXPORT_SETTINGS, ExportSettingsPanel, type ExportSettings } from "./export-settings";
import { StartPanel, type Goal } from "./start-panel";
import { ClipPack } from "./clip-pack";
import { MashupPanel } from "./mashup-panel";
import { findBeats, type Beat, MOODS } from "@/lib/assistant/mashup";
import { type EditPlan, type EditVideo, planEdits, planThemedEdit } from "@/lib/assistant/beat-edit";
import { planTalkEdits } from "@/lib/assistant/talk-edit";
import { outputDuration } from "@/lib/video/transitions";
import type { Playbook } from "@/lib/assistant/playbooks";
import { pickHooks } from "@/lib/assistant/hooks";
// Type-only (erased at build time), so the server-only module never reaches the browser.
import type { ThemeMashup, VisionVerdict } from "@/lib/assistant/claude";
import { TaskBanner } from "./task-banner";
import { WorkspaceNav } from "./workspace-nav";
import { ShareButton } from "./share-button";
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
interface ExportOutput {
  url: string;
  name: string;
  size: number;
  method: ExportMethod;
  /** Caption and hashtags to post with it (Clip Pack parts). */
  shareText?: string;
}

/** Identifies a clip range across renders (hooks, drops). */
const itemKey = (i: { clipId: string; start: number }) => `${i.clipId}@${i.start.toFixed(2)}`;

type ExportState =
  | { status: "idle"; message?: string }
  | { status: "running"; progress: number }
  | { status: "done"; outputs: ExportOutput[] }
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
  // The project saved on this device is put back automatically; this drives the "picked up where you left off" bar.
  const [restoring, setRestoring] = useState(false);
  const [welcomeBack, setWelcomeBack] = useState<{ savedAt: number; videos: number } | null>(null);
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
  const [edits, setEdits] = useState<EditPlan[] | null>(null);
  const [editIds, setEditIds] = useState<string[]>([]);
  /** Moments AI picked for the current edits (kept so changing the beat doesn't pay for a new pick). */
  const editAiPicks = useRef<ViralClip[]>([]);
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

  // Put back the project saved on this device, so leaving the editor (Pricing,
  // Account, a reload) never loses work. "Start fresh" is one click away.
  useEffect(() => {
    if (!projectStore.available()) return;
    let cancelled = false;
    projectStore
      .load()
      .then((saved) => {
        if (saved && !cancelled) void restoreProject(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Once, on arrival; restoreProject reads the initial render's state on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the scroll position too, so coming back lands on the same tool.
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
      } catch {}
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
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
          viral: viral ?? undefined,
        })
        .catch(() => setMemory("unavailable"));
    }, 500);
    return () => clearTimeout(timer);
  }, [timeline, mode, viral]);

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
    setWelcomeBack(null);
    await projectStore.clear().catch(() => {});
  }

  async function restoreProject(saved: NonNullable<Awaited<ReturnType<typeof projectStore.load>>>) {
    setRestoring(true);
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
    const savedViral = saved.project.viral as typeof viral | undefined;
    if (savedViral?.clips?.length) setViral(savedViral);
    setPending([]);
    setMemory("saved");
    setRestoring(false);
    setWelcomeBack({ savedAt: saved.project.savedAt, videos: saved.clips.length });
    // Back to where they were on the page, once the restored tools have rendered.
    try {
      const y = Number(sessionStorage.getItem(SCROLL_KEY));
      if (y > 0) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y })));
    } catch {}
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

  async function findViral(
    range: ViralRange,
    kind: VideoKind = "auto",
    /** What the audience rewards most (Clip Pack playbooks); default weights otherwise. */
    weights?: ViralClip["scores"],
  ): Promise<{ clips: ViralClip[]; basis: "transcript" | "scenes" } | null> {
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
      const opts = { minSeconds: range.min, maxSeconds: range.max, maxClips: 10, weights };
      let basis = "scenes" as "transcript" | "scenes";
      const found = ids.flatMap((id) => {
        const words = speech && !byScenes(id) ? (transcripts.current.get(id) ?? []) : [];
        const byWords = words.length > 20 ? findViralClips(id, words, analyses.current.get(id), opts) : [];
        if (byWords.length) {
          basis = "transcript";
          return byWords;
        }
        return findClipsByScene(id, timeline.clips[id].info.duration, analyses.current.get(id)!, opts);
      });
      let clips = found.sort((a, b) => b.score - a.score);
      let improved = false;
      if (basis === "transcript" && plan !== "free") {
        // Pro and Studio: AI reads the whole transcript and picks, like the big clipping tools.
        const spoken = ids.filter((id) => (transcripts.current.get(id)?.length ?? 0) > 20);
        const picks = spoken.length ? await aiPickClips(mostSpoken(spoken), range, 8, true, weights) : null;
        if (picks?.length) {
          clips = [...picks, ...clips.filter((c) => c.clipId !== picks[0].clipId)].sort((a, b) => b.score - a.score);
          improved = true;
        }
      }
      const result = { clips: clips.slice(0, 10), basis };
      setViral({ ...result, improved, range });
      return result;
    } catch (err) {
      if (!(err instanceof CancelledError)) setErrors((e) => [...e, "Couldn't analyse the video for viral clips. Please try again."]);
      return null;
    } finally {
      setTask(null);
    }
  }

  /**
   * AI picks (Pro, Studio): Claude reads the whole transcript of one video
   * and picks and packages the moments most likely to travel, like the big
   * clipping tools do. Null when it isn't available (free plan, no speech,
   * credits used up); `quiet` skips the error message, for automatic use.
   */
  async function aiPickClips(
    clipId: string,
    range: { min: number; max: number },
    count: number,
    quiet = false,
    /** What the audience rewards (Clip Pack playbooks), for ranking the AI's scores. */
    weights?: ViralClip["scores"],
  ): Promise<ViralClip[] | null> {
    if (plan === "free") return null;
    const sentences = toSentences(transcripts.current.get(clipId) ?? []);
    if (sentences.length < 3) {
      if (!quiet) setErrors((e) => [...e, "AI needs a video with speech to pick clips."]);
      return null;
    }
    setTask({ label: "AI is reading the whole conversation for the moments that will travel…", progress: null });
    try {
      const res = await fetch("/api/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentences: sentences.map(({ text, start, end }) => ({ text, start, end })),
          minSeconds: range.min,
          maxSeconds: range.max,
          count,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        clips?: { startSentence: number; endSentence: number; scores: ViralClip["scores"]; reasons: string[]; title: string; caption: string; hashtags: string[] }[];
        error?: string;
      } | null;
      if (!res.ok || !body?.clips) {
        const messages: Record<string, string> = {
          sign_in: "Sign in to let AI pick your clips.",
          upgrade: "AI picks are part of Pro and Studio.",
          limit: "You've used today's AI allowance, so these are the built-in picks.",
          not_configured: "AI picks aren't set up on this site yet, so these are the built-in picks.",
        };
        if (!quiet || body?.error === "limit") setErrors((e) => [...e, messages[body?.error ?? ""] ?? "AI couldn't review this video right now, so these are the built-in picks."]);
        return null;
      }
      return body.clips.map((c, i) => ({
        id: `${clipId}:ai${i}`,
        clipId,
        start: Math.max(0, sentences[c.startSentence].start - 0.15),
        end: sentences[c.endSentence].end + 0.3,
        score: overallScore(c.scores, weights),
        scores: c.scores,
        hook: sentences[c.startSentence].text,
        reasons: c.reasons,
        title: c.title || sentences[c.startSentence].text,
        caption: c.caption,
        hashtags: c.hashtags,
      }));
    } catch {
      return null;
    } finally {
      setTask(null);
    }
  }

  /** The video with the most speech among these: the one AI picks read. */
  const mostSpoken = (ids: string[]) => [...ids].sort((a, b) => (transcripts.current.get(b)?.length ?? 0) - (transcripts.current.get(a)?.length ?? 0))[0];

  async function improveViral() {
    if (!viral) return;
    const id = mostSpoken([...new Set(viral.clips.map((c) => c.clipId))]);
    const picks = await aiPickClips(id, viral.range, 8);
    if (!picks) return;
    const others = viral.clips.filter((c) => c.clipId !== id);
    setViral({ ...viral, clips: [...picks, ...others].sort((a, b) => b.score - a.score).slice(0, 10), improved: true });
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

  /**
   * AI Vision (Studio): grabs four frames from each candidate, asks Claude to
   * judge and write them, and returns the candidates re-ranked with the AI's
   * title, caption, reasons and hook. Null if it isn't available; the caller
   * carries on with the built-in picks.
   */
  async function reviewWithVision(candidates: ViralClip[], audience?: string): Promise<{ clips: ViralClip[]; hooks: Map<string, string> } | null> {
    const label = "AI Vision is looking at your clips…";
    setTask({ label, progress: 0 });
    try {
      const payload = [];
      for (const [i, c] of candidates.entries()) {
        const len = c.end - c.start;
        const frames = await engine.extractFrames(c.clipId, [0.15, 0.4, 0.65, 0.9].map((f) => c.start + len * f), 384);
        payload.push({
          id: c.id,
          start: c.start,
          end: c.end,
          notes: `measured viral score ${c.score}; ${c.reasons.join(", ")}`,
          frames: frames.flatMap((f) => (f ? [toBase64(f)] : [])),
        });
        setTask({ label, progress: ((i + 1) / candidates.length) * 0.4 });
      }
      setTask({ label: "AI Vision is judging your clips…", progress: null });
      const res = await fetch("/api/viral/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: payload, audience }),
      });
      const body = (await res.json().catch(() => null)) as { clips?: VisionVerdict[]; error?: string } | null;
      if (!res.ok || !body?.clips) {
        const why: Record<string, string> = {
          sign_in: "sign in to use it",
          upgrade: "it's part of Studio",
          limit: "today's AI credits are used up",
          not_configured: "it isn't set up on this site yet",
          busy: "the AI is busy",
        };
        setErrors((e) => [...e, `AI Vision was skipped (${why[body?.error ?? ""] ?? "it didn't respond"}). Your pack uses the built-in picks.`]);
        return null;
      }
      const verdicts = new Map(body.clips.map((v) => [v.id, v]));
      const hooks = new Map<string, string>();
      const clips = candidates
        .filter((c) => verdicts.has(c.id))
        .map((c) => {
          const v = verdicts.get(c.id)!;
          if (v.hook) hooks.set(itemKey(c), v.hook);
          return {
            ...c,
            score: v.score,
            hook: v.what || c.hook,
            reasons: [v.why, ...c.reasons].filter(Boolean).slice(0, 3),
            title: v.title || c.title,
            caption: v.caption || c.caption,
            hashtags: v.hashtags.length ? v.hashtags : c.hashtags,
            keep: v.keep,
          };
        })
        // Worth posting first, then by the AI's score.
        .sort((a, b) => Number(b.keep) - Number(a.keep) || b.score - a.score)
        .map((c) => {
          const { keep, ...clip } = c;
          void keep;
          return clip;
        });
      return clips.length ? { clips, hooks } : null;
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      setErrors((e) => [...e, "AI Vision was skipped (something went wrong). Your pack uses the built-in picks."]);
      return null;
    } finally {
      setTask(null);
    }
  }

  /** Clip Pack: find the best moments, optionally let AI Vision judge them, and export finished posts. */
  /**
   * Clip Pack: picks the moments this audience rewards (playbook weights and
   * lengths), optionally lets AI Vision judge them, then exports finished
   * posts: flash-forward intro with a flash cut (where it suits the audience),
   * hook, PART badge, captions, music chosen per clip, and an end card.
   */
  async function makeClipPack(pb: Playbook, count: number, useVision: boolean) {
    const range: ViralRange = { min: pb.range.min, max: pb.range.max, label: pb.range.label };
    const found = await findViral(range, pb.kind, pb.weights);
    if (!found) return;
    if (found.clips.length === 0) {
      setErrors((e) => [...e, "No clips stood out in that length range. Try another category or a longer video."]);
      return;
    }
    const wanted = Math.min(count, limits.packClips);
    let picks = found.clips;
    let hooks = new Map<string, string>();
    if (useVision && limits.aiVision) {
      try {
        const reviewed = await reviewWithVision(found.clips.slice(0, Math.min(8, wanted + 3)), pb.audience);
        if (reviewed) {
          picks = reviewed.clips;
          hooks = reviewed.hooks;
          setViral({ clips: picks, basis: found.basis, improved: true, range });
        }
      } catch (err) {
        if (err instanceof CancelledError) return;
      }
    }
    picks = picks.slice(0, wanted);
    // Hooks AI Vision didn't write come from the hook library, in the techniques this audience responds to.
    const library = pickHooks(picks, found.basis, pb.hooks);
    picks.forEach((c, i) => {
      if (!hooks.has(itemKey(c))) hooks.set(itemKey(c), library[i]);
    });

    // Flash-forward cold open (~1.8 s of the peak, then a white flash cut into
    // the build-up) for audiences where seeing the payoff first hooks them.
    // Never for comedy: a punchline shown first is a punchline spoiled.
    const TEASER = 1.8;
    const drops = new Map<string, number>();
    const musicStyles = new Map<string, MusicStyle | "none">();
    const badges = new Map<string, string>();
    const groups = picks.map((c, i) => {
      const info = timeline.clips[c.clipId].info;
      const main = { clipId: c.clipId, info, start: c.start, end: c.end };
      const peak = c.peak ?? c.start + outputPeak([main], analyses.current);
      const intro = pb.coldOpen && c.end - c.start >= 12 && peak - c.start > TEASER + 2;
      const teaserStart = Math.min(Math.max(c.start, peak - TEASER / 2), c.end - TEASER);
      const group = intro ? [{ ...main, start: teaserStart, end: teaserStart + TEASER }, { ...main, flashIn: true }] : [main];
      // The beat drops when the real peak comes round again, after the intro.
      drops.set(itemKey(main), (intro ? TEASER : 0) + (peak - c.start));
      musicStyles.set(itemKey(main), pb.music(c.scores));
      badges.set(itemKey(main), `PART ${i + 1}`);
      return group;
    });

    const firstMusic = pb.music(picks[0].scores);
    const packSettings: ExportSettings = {
      ...settings,
      aspect: "9:16",
      fit: "blur",
      captions: pb.captions,
      captionStyle: limits.captionStyles === "all" ? pb.captionStyle : "clean",
      hook: { on: true, text: "" },
      progressBar: true,
      music: firstMusic === "none" ? { ...settings.music, style: "none" } : { ...settings.music, style: firstMusic, volume: pb.musicVolume },
    };
    setSettings(packSettings);
    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    // Scene picks without AI Vision are titled "Scene 2 · 6:30"; their hook reads better.
    const titleOf = (c: ViralClip, i: number) => (/^Scene \d/.test(c.title) ? library[i] : c.title);
    const shareTexts = picks.map((c) => [c.caption.trim(), c.hashtags.join(" ")].filter(Boolean).join("\n\n"));
    const postKit = [
      `Clip Pack: ${pb.label} (${picks.length} clip${picks.length === 1 ? "" : "s"})`,
      `Made for: ${pb.audience}`,
      "",
      ...picks.flatMap((c, i) => [
        `PART ${String(i + 1).padStart(2, "0")} · ${timeline.clips[c.clipId]?.file.name ?? "video"} ${mmss(c.start)}-${mmss(c.end)} · score ${c.score}`,
        `Hook (on screen): ${hooks.get(itemKey(c)) ?? ""}`,
        `Title: ${titleOf(c, i)}`,
        `Caption: ${c.caption}`,
        `Hashtags: ${c.hashtags.join(" ")}`,
        ...(c.reasons.length ? [`Why: ${c.reasons.join("; ")}`] : []),
        "",
      ]),
      "Tip: post 1-2 parts a day in order, and pin a comment asking which part they want next.",
    ].join("\n");
    document.getElementById("export")?.scrollIntoView({ behavior: "smooth" });
    await startExport(
      picks.map((c) => ({ clipId: c.clipId, info: timeline.clips[c.clipId].info, start: c.start, end: c.end })),
      "parts",
      { settings: packSettings, hooks, postKit, groups, drops, musicStyles, badges, endCard: 1.6, outro: pb.outro, shareTexts, normalize: true },
    );
  }

  /** The videos the last edits were made from, with their analyses (to re-cut on another beat). */
  function editVideos(ids: string[]): EditVideo[] {
    return ids.flatMap((id) => {
      const a = analyses.current.get(id);
      const clip = timeline.clips[id];
      return a && clip ? [{ clipId: id, name: clip.file.name, duration: clip.info.duration, analysis: a }] : [];
    });
  }

  /** Mostly talking (podcasts, streams, interviews): sound, and few cuts. These get transcribed for quote edits. */
  const isTalking = (v: EditVideo) => Boolean(timeline.clips[v.clipId]?.info.audioCodec) && cutsPerMinute(v.analysis) < 6;
  /** Has action worth a beat edit: edited footage, or real bursts of movement. */
  const hasAction = (v: EditVideo) => {
    const sorted = [...v.analysis.motion].sort((a, b) => a - b);
    return cutsPerMinute(v.analysis) >= 2 || (sorted[Math.floor(sorted.length * 0.95)] ?? 0) >= 6;
  };

  /**
   * Edits for these videos. Content is rarely just one thing, so every video
   * with sound can give quote edits (when there's a transcript) and a
   * countdown, and every video with action gives beat edits; whichever the
   * footage mostly is comes first.
   */
  function planAllEdits(ids: string[], styles: Partial<Record<EditPlan["format"], MusicStyle>> = {}): EditPlan[] {
    const videos = editVideos(ids);
    const voiced = videos.filter((v) => timeline.clips[v.clipId]?.info.audioCodec).map((v) => ({ ...v, words: transcripts.current.get(v.clipId) ?? [] }));
    const action = videos.filter(hasAction);
    const fps = computeCanvas(timeline.clips[ids[0]].info, limits.maxShortSide, "9:16").fps;
    const talk = voiced.length ? planTalkEdits(voiced, fps, styles, editAiPicks.current) : [];
    const beat = action.length ? planEdits(action, styles) : [];
    return videos.filter(isTalking).length > videos.length / 2 ? [...talk, ...beat] : [...beat, ...talk];
  }

  /**
   * Edits: analyses the chosen videos and plans the edits that suit each:
   * beat-synced edits (hype, versus, emotional) for action footage, quote
   * edits and a Top 3 countdown for talking footage, and with AI Theme Match
   * (Studio) one built around a story theme Claude finds across them.
   */
  async function findMashups(videoIds: string[], useAi: boolean) {
    setEdits(null);
    const ids = videoIds.filter((id) => timeline.clips[id]).slice(0, limits.mashupVideos);
    if (ids.length < 1) return;
    try {
      const total = ids.reduce((sum, id) => sum + timeline.clips[id].info.duration, 0);
      let done = 0;
      for (const id of ids) {
        const { info } = timeline.clips[id];
        await getAnalysis(id, info, (r) => setTask({ label: `Watching ${ids.length === 1 ? "your video" : `${ids.length} videos`} for the big moments…`, progress: total ? (done + r * info.duration) / total : null }));
        done += info.duration;
      }
      // Talking videos are clipped on what's said: transcribe them (in any language).
      const talkingIds = editVideos(ids).filter(isTalking).map((v) => v.clipId);
      if (talkingIds.length) {
        try {
          await ensureTranscripts(talkingIds);
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          setErrors((e) => [...e, "The speech model didn't load, so talking clips are picked on sound alone. Check your connection for quote edits."]);
        } finally {
          setTask(null);
        }
      }
      // Pro and Studio: AI reads the whole conversation and picks the quotes and countdown moments.
      editAiPicks.current = [];
      const spoken = ids.filter((id) => (transcripts.current.get(id)?.length ?? 0) > 20);
      if (spoken.length && plan !== "free") editAiPicks.current = (await aiPickClips(mostSpoken(spoken), { min: 7, max: 28 }, 8, true)) ?? [];
      setEditIds(ids);
      let found = planAllEdits(ids);
      const action = editVideos(ids).filter(hasAction);
      if (useAi && limits.aiVision && action.length >= 2) {
        const themed = await matchThemesWithAi(action.map((v) => v.clipId), action);
        if (themed.length) found = [...themed, ...found];
      }
      setEdits(found);
    } catch (err) {
      if (!(err instanceof CancelledError)) setErrors((e) => [...e, "Couldn't analyse the videos for an edit. Please try again."]);
    } finally {
      setTask(null);
    }
  }

  /** Re-cuts one edit to another beat (beat edits follow the tempo; talking edits switch shots on its bars). */
  function restyleEdit(plan: EditPlan, music: MusicStyle) {
    const next = planAllEdits(editIds, { [plan.format]: music }).find((p) => p.id === plan.id);
    if (next) setEdits((list) => list?.map((p) => (p.id === plan.id ? next : p)) ?? null);
  }

  /** AI Theme Match: two stills from each of the strongest moments per video go to Claude, which groups them by theme. */
  async function matchThemesWithAi(ids: string[], videos: EditVideo[]): Promise<EditPlan[]> {
    const label = "AI Theme Match is looking at the moments…";
    setTask({ label, progress: 0 });
    const beats = findBeats(videos);
    // The strongest moments of every feel from each video, taken in turn, at most 18.
    const perVideo = ids.map((id) => beats.filter((b) => b.clipId === id).sort((a, b) => b.fit - a.fit).slice(0, 6));
    const chosen: Beat[] = [];
    for (let round = 0; round < 6 && chosen.length < 18; round++) {
      for (const list of perVideo) if (list[round] && chosen.length < 18) chosen.push(list[round]);
    }
    try {
      const moments = [];
      for (const [i, b] of chosen.entries()) {
        const len = b.end - b.start;
        const frames = await engine.extractFrames(b.clipId, [b.start + len * 0.3, b.start + len * 0.75], 384);
        const said = (transcripts.current.get(b.clipId) ?? []).filter((w) => w.start >= b.start && w.end <= b.end).map((w) => w.text).join(" ").trim();
        moments.push({
          id: b.id,
          video: `Video ${ids.indexOf(b.clipId) + 1} (${timeline.clips[b.clipId].file.name})`,
          start: b.start,
          end: b.end,
          notes: `measured feel: ${MOODS[b.mood].feel}${said ? `; says: "${said.slice(0, 160)}"` : ""}`,
          frames: frames.flatMap((f) => (f ? [toBase64(f)] : [])),
        });
        setTask({ label, progress: ((i + 1) / chosen.length) * 0.5 });
      }
      setTask({ label: "AI Theme Match is grouping them by theme…", progress: null });
      const res = await fetch("/api/mashup/themes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moments }) });
      const body = (await res.json().catch(() => null)) as { mashups?: ThemeMashup[]; error?: string } | null;
      if (!res.ok || !body?.mashups) {
        const why: Record<string, string> = {
          sign_in: "sign in to use it",
          upgrade: "it's part of Studio",
          limit: "today's AI credits are used up",
          not_configured: "it isn't set up on this site yet",
          busy: "the AI is busy",
        };
        setErrors((e) => [...e, `AI Theme Match was skipped (${why[body?.error ?? ""] ?? "it didn't respond"}). These edits are built from the measured moments.`]);
        return [];
      }
      const byId = new Map(chosen.map((b) => [b.id, b]));
      return body.mashups.flatMap((m, i) => {
        const plan = planThemedEdit(
          videos,
          m.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
          { id: `ai-${i}`, title: m.title, why: [m.theme && `Theme: ${m.theme}.`, m.why].filter(Boolean).join(" "), hook: m.hook || "Same story, different worlds", music: m.music },
        );
        return plan ? [plan] : [];
      });
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      setErrors((e) => [...e, "AI Theme Match was skipped (something went wrong). These edits are built from the measured moments."]);
      return [];
    }
  }

  /** Exports an edit as one 9:16 video: every cut on its beat (frame-exact), effects, the composed beat dropping on the big hit. */
  async function makeEdit(plan: EditPlan) {
    const items: ExportItem[] = plan.shots.map((s) => ({
      clipId: s.clipId,
      info: timeline.clips[s.clipId].info,
      start: s.start,
      end: s.end,
      ...(s.speed ? { speed: s.speed } : {}),
      ...(s.fx ? { fx: s.fx } : {}),
    }));
    const last = items[items.length - 1];
    const editSettings: ExportSettings = {
      ...settings,
      aspect: "9:16",
      fit: "blur",
      captions: plan.captions,
      captionStyle: limits.captionStyles === "all" ? "bold-pop" : "clean",
      hook: { on: true, text: "" },
      // A progress bar helps long talking clips; beat edits loop, so they go without.
      progressBar: !plan.exact || plan.format === "quote",
      music: { style: plan.music, ...plan.mix },
    };
    setSettings(editSettings);
    document.getElementById("export")?.scrollIntoView({ behavior: "smooth" });
    await startExport(items, "stitch", {
      settings: editSettings,
      hooks: new Map([[itemKey(last), plan.hook]]),
      drops: new Map([[itemKey(last), plan.dropAt]]),
      outro: plan.cta,
      normalize: true,
      frameExact: plan.exact,
      labels: plan.labels,
    });
  }

  function editToTimeline(plan: EditPlan) {
    setHistory((h) => [...h.slice(-19), timeline.segments.map(({ clipId, start, end }) => ({ clipId, start, end }))]);
    dispatch({ type: "replaceSegments", segments: plan.shots.map(({ clipId, start, end }) => ({ clipId, start, end })) });
    document.querySelector("[data-testid=segment-list]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /**
   * Exports `items`. A Clip Pack passes its own settings (it changes them and
   * exports in the same click, before React state updates land), the hook
   * text for each clip, and a post kit to save alongside the videos.
   */
  async function startExport(
    items = toExportItems(timeline),
    exportMode: ExportMode = mode,
    run: {
      settings?: ExportSettings;
      /** Hook text per clip, keyed by itemKey of the clip's main item. */
      hooks?: Map<string, string>;
      postKit?: string;
      /** Parts made of several items (flash-forward intro + clip); exported instead of `items` one by one. */
      groups?: ExportItem[][];
      /** Closing call to action over the last 1.6 s. */
      outro?: string;
      /** Exact music drop time (output seconds) per part, keyed like `hooks`. */
      drops?: Map<string, number>;
      /** Caption + hashtags for each part, for sharing. */
      shareTexts?: string[];
      /** Even out loudness for the platforms. */
      normalize?: boolean;
      /** Music style per part (keyed like `hooks`), chosen from each clip's shape. */
      musicStyles?: Map<string, MusicStyle | "none">;
      /** Series label per part ("PART 1"). */
      badges?: Map<string, string>;
      /** Seconds of end card (last frame held and dimmed) for the call to action. */
      endCard?: number;
      /** Beat-synced edit: cut on exact frames so every cut stays on its beat. */
      frameExact?: boolean;
      /** Big on-screen labels in output time ("#3", "#2", "#1"). */
      labels?: { text: string; start: number; end: number }[];
    } = {},
  ) {
    let s = run.settings ?? settings;
    if (exportMode === "stitch" && new Set(items.map((i) => i.clipId)).size > limits.maxStitchClips) {
      setExportState({ status: "error", message: `The ${limits.label} plan stitches up to ${limits.maxStitchClips} videos. Upgrade to Pro for unlimited.` });
      return;
    }
    clearOutputs();
    if (s.captions) {
      try {
        await ensureTranscripts([...new Set(items.map((i) => i.clipId))]);
      } catch (err) {
        setTask(null);
        if (err instanceof CancelledError) return;
        if (run.settings) {
          // A Clip Pack still delivers its clips, just without captions.
          s = { ...s, captions: false };
          setErrors((e) => [...e, "Captions were skipped: the speech model didn't load. Check your connection and export again for captions."]);
        } else {
          setExportState({
            status: "error",
            message: "Couldn't create captions (the speech model didn't load). Check your connection, or turn captions off and export again.",
          });
          return;
        }
      } finally {
        setTask(null);
      }
    }
    const music = s.music;
    const composed = music.style !== "none" && music.style !== "own" ? music.style : null;
    const anyPartMusic = run.musicStyles && [...run.musicStyles.values()].some((m) => m !== "none");
    if (composed || anyPartMusic) {
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
    const style = limits.captionStyles === "all" ? s.captionStyle : "clean";
    const options = {
      maxShortSide: limits.maxShortSide,
      fastCut,
      aspect: s.aspect,
      fit: s.fit,
      watermark: limits.watermark,
      logo: limits.brandLogo ? (logo?.bytes ?? null) : null,
      captions:
        s.captions || s.hook.on || run.outro || run.badges || run.labels
          ? (renderItems: ExportItem[], canvas: Parameters<typeof buildAss>[2]) => {
              const words = s.captions
                ? wordsForOutput(renderItems, Object.fromEntries(transcripts.current), limits.captionSeconds)
                : [];
              const hookText = s.hook.on ? hookFor(renderItems, s, run.hooks) : null;
              const total = outputDuration(renderItems);
              const card = run.endCard ?? 0;
              // On the end card when there is one; else over the last moments of the clip.
              const outro = run.outro && total > 8 ? { text: run.outro, start: card ? total - 0.2 : total - 1.6, end: total + card } : undefined;
              const badgeText = run.badges?.get(itemKey(renderItems[renderItems.length - 1]));
              const badge = badgeText ? { text: badgeText, end: total } : undefined;
              if (!words.length && !hookText && !outro && !badge && !run.labels?.length) return null;
              return buildAss(words, style, canvas, { ...(hookText ? { hook: { text: hookText, seconds: 3 } } : {}), outro, badge, labels: run.labels });
            }
          : undefined,
      progressBar: s.progressBar,
      normalize: run.normalize,
      endCard: run.endCard,
      frameExact: run.frameExact,
      music:
        composed || anyPartMusic || (music.style === "own" && ownTrack)
          ? async (renderItems: ExportItem[], duration: number) => {
              const mix = { volume: music.volume, original: music.original, duck: music.duck };
              const partStyle = run.musicStyles?.get(itemKey(renderItems[renderItems.length - 1]));
              if (partStyle === "none") return null;
              const style = partStyle ?? composed;
              if (!style) return music.style === "own" && ownTrack ? { ...mix, bytes: ownTrack.bytes, ext: ownTrack.ext } : null;
              const seed = Math.round(renderItems[0].start * 10) + renderItems.length;
              const drop = run.drops?.get(itemKey(renderItems[renderItems.length - 1])) ?? outputPeak(renderItems, analyses.current);
              return { ...mix, bytes: await composeWav(style, duration, drop, seed), ext: "wav" };
            }
          : undefined,
      onProgress: (progress: number) => setExportState({ status: "running", progress }),
    };
    try {
      const results: ExportResult[] =
        exportMode === "stitch" ? [await exportStitched(engine, items, options)] : await exportParts(engine, run.groups ?? items, options);
      const outputs: ExportOutput[] = results.map((r, i) => {
        const url = URL.createObjectURL(r.blob);
        outputUrls.current.push(url);
        return { url, name: r.name, size: r.blob.size, method: r.method, shareText: run.shareTexts?.[i] };
      });
      if (run.postKit) {
        const kit = new Blob([run.postKit], { type: "text/plain" });
        const url = URL.createObjectURL(kit);
        outputUrls.current.push(url);
        outputs.push({ url, name: "post-kit.txt", size: kit.size, method: "copy" });
      }
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
  function hookFor(renderItems: ExportItem[], s: ExportSettings = settings, hooks?: Map<string, string>): string | null {
    // The caption fonts have no emoji, so they'd burn in as empty boxes.
    const plain = (t: string) => t.replace(/\p{Extended_Pictographic}|\uFE0F/gu, "").replace(/\s+/g, " ").trim();
    const custom = plain(s.hook.text);
    if (custom) return custom;
    const main = renderItems[renderItems.length - 1];
    const given = main && hooks?.get(itemKey(main));
    if (given) return plain(given) || null;
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

        {restoring && (
          <p className="notice notice-info animate-pulse" role="status" data-testid="restoring">
            Restoring your project…
          </p>
        )}
        {welcomeBack && !restoring && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/30 bg-ok/[0.06] px-4 py-2.5 text-sm" data-testid="restore">
            <p>
              ✓ Picked up where you left off: your project from {timeAgo(welcomeBack.savedAt)} ({welcomeBack.videos} video
              {welcomeBack.videos === 1 ? "" : "s"}).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  // Clear the saved project and reload into an empty editor.
                  void startFresh().then(() => window.location.reload());
                }}
              >
                Start fresh
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWelcomeBack(null)} aria-label="Dismiss">
                ✕
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
          {segments.length === 0 && !restoring ? (
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
          <ClipPack limits={limits} busy={Boolean(task) || running || engineStatus !== "ready"} onMake={(p, n, v) => void makeClipPack(p, n, v)} />
        )}

        {segments.length > 0 && (
          <MashupPanel
            videos={Object.keys(clips).map((id) => ({ id, name: clips[id].file.name, url: clips[id].url, color: colors[id] }))}
            limits={limits}
            busy={Boolean(task) || running || engineStatus !== "ready"}
            edits={edits?.filter((p) => p.shots.every((x) => clips[x.clipId])) ?? null}
            onFind={(ids, ai) => void findMashups(ids, ai)}
            onMake={(p) => void makeEdit(p)}
            onTimeline={editToTimeline}
            onRestyle={restyleEdit}
            onAddVideos={() => fileInput.current?.click()}
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
            {exportState.status === "done" && <Outputs outputs={exportState.outputs} canShare={plan === "studio"} />}
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

const SCROLL_KEY = "anti-timeout:scroll";
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

function Outputs({ outputs, canShare }: { outputs: ExportOutput[]; canShare: boolean }) {
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
              {o.name.endsWith(".mp4") && <ShareButton url={o.url} name={o.name} text={o.shareText} allowed={canShare} />}
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

/** Base64 of bytes, in chunks (spreading a large array into one call overflows the stack). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
