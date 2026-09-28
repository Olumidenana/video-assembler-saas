import type { Metadata } from "next";
import { EditorLoader } from "./editor-loader";

export const metadata: Metadata = { title: "Editor · Anti-Timeout" };

export default function EditorPage() {
  // Stage 3: read the signed-in user's subscription from Supabase.
  const plan = "free";

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Editor</h1>
      <EditorLoader plan={plan} />
    </section>
  );
}
