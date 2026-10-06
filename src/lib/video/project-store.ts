/**
 * Remembers the current project on this device (IndexedDB), so reloading or
 * closing the tab doesn't lose work. Videos are stored as Blobs in the
 * browser's own storage; nothing leaves the device.
 */
import type { ClipAnalysis } from "./analysis";
import type { Word } from "./captions";
import type { MediaInfo } from "./types";

const DB_NAME = "anti-timeout";
const VERSION = 1;
const CLIPS = "clips";
const META = "meta";
const PROJECT_KEY = "project";

/** Skip remembering very large projects: browsers may refuse, and restoring would be slow. */
export const MAX_REMEMBERED_BYTES = 1.5 * 1024 ** 3;

export interface StoredClip {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  info: MediaInfo;
  analysis?: ClipAnalysis;
  transcript?: Word[];
  /** The speech settings the transcript was made with (see speechKey). */
  transcriptKey?: string;
}

export interface StoredProject {
  clipIds: string[];
  segments: { clipId: string; start: number; end: number }[];
  mode: "stitch" | "parts";
  savedAt: number;
  /** The last Viral Clip Finder results, so they're still there after a reload. */
  viral?: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CLIPS)) db.createObjectStore(CLIPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const projectStore = {
  /** False in private windows and some embedded browsers. */
  available(): boolean {
    return typeof indexedDB !== "undefined";
  },

  async saveClip(clip: StoredClip): Promise<void> {
    await run(CLIPS, "readwrite", (s) => s.put(clip));
  },

  async saveAnalysis(id: string, analysis: ClipAnalysis): Promise<void> {
    const existing = await run<StoredClip>(CLIPS, "readonly", (s) => s.get(id));
    if (existing) await run(CLIPS, "readwrite", (s) => s.put({ ...existing, analysis }));
  },

  async saveTranscript(id: string, transcript: Word[], transcriptKey: string): Promise<void> {
    const existing = await run<StoredClip>(CLIPS, "readonly", (s) => s.get(id));
    if (existing) await run(CLIPS, "readwrite", (s) => s.put({ ...existing, transcript, transcriptKey }));
  },

  async deleteClip(id: string): Promise<void> {
    await run(CLIPS, "readwrite", (s) => s.delete(id));
  },

  async saveProject(project: StoredProject): Promise<void> {
    await run(META, "readwrite", (s) => s.put(project, PROJECT_KEY));
  },

  /** The saved project and its videos, or null if there's nothing (complete) to restore. */
  async load(): Promise<{ project: StoredProject; clips: StoredClip[] } | null> {
    const project = await run<StoredProject>(META, "readonly", (s) => s.get(PROJECT_KEY));
    if (!project || project.segments.length === 0) return null;
    const clips: StoredClip[] = [];
    for (const id of project.clipIds) {
      const clip = await run<StoredClip>(CLIPS, "readonly", (s) => s.get(id));
      if (clip) clips.push(clip);
    }
    return clips.length ? { project, clips } : null;
  },

  async clear(): Promise<void> {
    await run(CLIPS, "readwrite", (s) => s.clear());
    await run(META, "readwrite", (s) => s.clear());
  },
};
