"use client";

import dynamic from "next/dynamic";
import type { PlanId } from "@/lib/plans";

// The editor needs window, Workers and File APIs, so it only renders in the browser.
const Editor = dynamic(() => import("./editor").then((m) => m.Editor), {
  ssr: false,
  loading: () => <p className="text-sm text-foreground/60">Loading editor…</p>,
});

export function EditorLoader({ plan }: { plan: PlanId }) {
  return <Editor plan={plan} />;
}
