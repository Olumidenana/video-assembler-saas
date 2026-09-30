"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowRightIcon, SparkIcon } from "./icons";

const COMMANDS = [
  "Make a 30 second highlight",
  "Remove the silent parts",
  "Split into 30s parts for WhatsApp Status",
  "Cut the first 5 seconds and export",
];

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** A command bar that "types" example requests, for the landing page. */
export function TypingCommand() {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);

  useEffect(() => {
    if (reduced) return;
    const full = COMMANDS[index];
    const done = length >= full.length;
    const timer = setTimeout(
      () => {
        if (done) {
          setIndex((i) => (i + 1) % COMMANDS.length);
          setLength(0);
        } else {
          setLength((n) => n + 1);
        }
      },
      done ? 1800 : 45,
    );
    return () => clearTimeout(timer);
  }, [index, length, reduced]);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line-strong bg-bg/80 p-2 pl-4 shadow-2xl shadow-brand/10" aria-hidden="true">
      <SparkIcon size={18} className="shrink-0 text-brand" />
      <p className="min-w-0 flex-1 truncate text-left font-mono text-sm sm:text-base">
        {reduced ? COMMANDS[0] : COMMANDS[index].slice(0, length)}
        <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-brand animate-caret" />
      </p>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 text-white">
        <ArrowRightIcon size={16} />
      </span>
    </div>
  );
}
