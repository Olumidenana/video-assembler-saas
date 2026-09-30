"use client";

import { ArrowDownIcon, ArrowUpIcon, XIcon } from "@/components/icons";
import type { Clip, Segment } from "@/lib/video/types";
import { formatTime } from "./format";

interface SegmentListProps {
  segments: Segment[];
  clips: Record<string, Clip>;
  colors: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  onSetRange: (id: string, range: { start?: number; end?: number }) => void;
}

export function SegmentList({
  segments,
  clips,
  colors,
  selectedId,
  onSelect,
  onMove,
  onRemove,
  onSetRange,
}: SegmentListProps) {
  const icon = "grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <ol className="flex flex-col gap-2" data-testid="segment-list">
      {segments.map((segment, i) => {
        const clip = clips[segment.clipId];
        const selected = segment.id === selectedId;
        return (
          <li
            key={segment.id}
            className={`relative overflow-hidden rounded-xl border p-3 pl-4 text-sm transition-colors ${
              selected ? "border-brand/60 bg-brand/[0.07]" : "border-line bg-surface hover:border-line-strong"
            }`}
          >
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: colors[segment.clipId] }} />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium"
                onClick={() => onSelect(segment.id)}
                title={clip.file.name}
              >
                <span className="mr-2 font-mono text-xs text-subtle">{String(i + 1).padStart(2, "0")}</span>
                {clip.file.name}
              </button>
              <div className="flex shrink-0 gap-0.5">
                <button type="button" className={icon} disabled={i === 0} onClick={() => onMove(segment.id, -1)} aria-label="Move up">
                  <ArrowUpIcon size={15} />
                </button>
                <button
                  type="button"
                  className={icon}
                  disabled={i === segments.length - 1}
                  onClick={() => onMove(segment.id, 1)}
                  aria-label="Move down"
                >
                  <ArrowDownIcon size={15} />
                </button>
                <button type="button" className={`${icon} hover:text-danger`} onClick={() => onRemove(segment.id)} aria-label="Remove">
                  <XIcon size={15} />
                </button>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-muted">
              <TimeInput label="Start" value={segment.start} onCommit={(start) => onSetRange(segment.id, { start })} />
              <TimeInput label="End" value={segment.end} onCommit={(end) => onSetRange(segment.id, { end })} />
              <span className="ml-auto font-mono text-xs text-subtle">{formatTime(segment.end - segment.start)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
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
        className="input h-8 w-20 font-mono text-xs"
        aria-label={`${label} (seconds)`}
      />
      s
    </label>
  );
}
