"use client";

import { useEffect, useState } from "react";

/** Long-running work (analysis, transcription): progress, a time-left estimate and Cancel. Remount (key) per task. */
export function TaskBanner({ label, progress, onCancel }: { label: string; progress: number | null; onCancel: () => void }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = (now - start) / 1000;
  // Estimate once there's enough to go on, so it doesn't jump around at the start.
  const left = progress !== null && progress > 0.04 && elapsed > 3 ? (elapsed * (1 - progress)) / progress : null;

  return (
    <div className="sticky top-20 z-30 flex flex-col gap-2 rounded-xl border border-brand/40 bg-surface/95 p-4 shadow-xl shadow-brand/10 backdrop-blur" role="status" data-testid="task">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-brand" /> {label}
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted" data-testid="task-eta">
            {progress !== null && `${Math.round(progress * 100)}%`}
            {left !== null && ` · ${formatLeft(left)} left`}
          </span>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={onCancel}>
            Cancel
          </button>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        {progress === null ? (
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-gradient-to-r from-brand to-brand-2" />
        ) : (
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
        )}
      </div>
    </div>
  );
}

function formatLeft(seconds: number): string {
  if (seconds < 10) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds / 5) * 5} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round((seconds % 60) / 10) * 10;
  return s ? `${m} min ${s} s` : `${m} min`;
}
