import type { Metadata } from "next";
import { IsolationStatus } from "./isolation-status";

export const metadata: Metadata = { title: "Editor · Anti-Timeout" };

export default function EditorPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Editor</h1>
      <IsolationStatus />
      {/* Stage 2: FFmpeg.wasm upload / trim / stitch UI goes here. */}
    </section>
  );
}
