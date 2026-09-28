"use client";

import type { Clip, Segment } from "@/lib/video/types";
import { formatTime } from "./format";

interface SegmentListProps {
  segments: Segment[];
  clips: Record<string, Clip>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  onSetRange: (id: string, range: { start?: number; end?: number }) => void;
}

export function SegmentList({ segments, clips, selectedId, onSelect, onMove, onRemove, onSetRange }: SegmentListProps) {
  const icon = "rounded border border-foreground/20 px-2 py-0.5 text-xs disabled:opacity-30";

  return (
    <ol className="flex flex-col gap-2" data-testid="segment-list">
      {segments.map((segment, i) => {
        const clip = clips[segment.clipId];
        const selected = segment.id === selectedId;
        return (
          <li
            key={segment.id}
            className={`rounded-lg border p-3 text-sm ${
              selected ? "border-foreground/60 bg-foreground/5" : "border-foreground/15"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium"
                onClick={() => onSelect(segment.id)}
                title={clip.file.name}
              >
                {i + 1}. {clip.file.name}
              </button>
              <div className="flex shrink-0 gap-1">
                <button type="button" className={icon} disabled={i === 0} onClick={() => onMove(segment.id, -1)} aria-label="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  className={icon}
                  disabled={i === segments.length - 1}
                  onClick={() => onMove(segment.id, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button type="button" className={icon} onClick={() => onRemove(segment.id)} aria-label="Remove">
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground/70">
              <TimeInput label="Start" value={segment.start} onCommit={(start) => onSetRange(segment.id, { start })} />
              <TimeInput label="End" value={segment.end} onCommit={(end) => onSetRange(segment.id, { end })} />
              <span className="font-mono">= {formatTime(segment.end - segment.start)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      {label}
      {/* Uncontrolled + keyed on value: typing is free, the reducer clamps on commit. */}
      <input
        key={value}
        type="number"
        step={0.1}
        min={0}
        defaultValue={Number(value.toFixed(2))}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isFinite(v) && v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-20 rounded border border-foreground/20 bg-transparent px-1.5 py-0.5 font-mono"
        aria-label={`${label} (seconds)`}
      />
      s
    </label>
  );
}
