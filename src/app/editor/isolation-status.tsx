"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Shows whether this document is cross-origin isolated (SharedArrayBuffer available). */
export function IsolationStatus() {
  const isolated = useSyncExternalStore(
    subscribe,
    () => window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined",
    () => null,
  );

  if (isolated === null) return null;

  return (
    <p
      data-testid="isolation-status"
      data-isolated={isolated}
      className={`rounded-md px-3 py-2 text-sm ${
        isolated ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }`}
    >
      {isolated
        ? "Multi-threaded engine available (cross-origin isolated)."
        : "Running in single-threaded mode. Your browser or this navigation didn't enable SharedArrayBuffer, so exports will be slower."}
    </p>
  );
}
