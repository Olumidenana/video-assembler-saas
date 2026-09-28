import { HardLink } from "@/components/hard-link";

export default function Home() {
  return (
    <section className="flex flex-col gap-6 py-12">
      <h1 className="text-3xl font-bold sm:text-5xl">
        Split and stitch videos without server timeouts.
      </h1>
      <p className="max-w-2xl text-lg text-foreground/70">
        Everything runs in your browser with FFmpeg.wasm. Your files never leave your device,
        so there are no upload waits and no serverless time limits.
      </p>
      <div className="flex gap-3">
        <HardLink
          href="/editor"
          className="rounded-md bg-foreground px-5 py-2.5 font-medium text-background"
        >
          Open the editor
        </HardLink>
        <HardLink href="/pricing" className="rounded-md border border-foreground/20 px-5 py-2.5">
          See Pro
        </HardLink>
      </div>
    </section>
  );
}
