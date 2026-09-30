import { HardLink } from "@/components/hard-link";
import {
  ArrowRightIcon,
  BoltIcon,
  ClockIcon,
  LayersIcon,
  LockIcon,
  ScissorsIcon,
  SplitIcon,
} from "@/components/icons";

const FEATURES = [
  {
    icon: LockIcon,
    title: "Private by design",
    body: "Your videos are processed on your own device. Nothing is uploaded, so nothing can leak.",
  },
  {
    icon: ClockIcon,
    title: "No timeouts, no queues",
    body: "Long exports never hit a server time limit, because there is no server doing the work.",
  },
  {
    icon: ScissorsIcon,
    title: "Frame-accurate trims",
    body: "Set start and end points from the preview or type exact times down to a tenth of a second.",
  },
  {
    icon: LayersIcon,
    title: "Stitch anything together",
    body: "Portrait, landscape, MP4, MOV, WebM, with or without sound. It all joins into one clean MP4.",
  },
  {
    icon: SplitIcon,
    title: "Split into parts",
    body: "Chop a long video into 30-second pieces for WhatsApp Status, Reels or Shorts in one click.",
  },
  {
    icon: BoltIcon,
    title: "Instant lossless joins",
    body: "Clips from the same camera are joined without re-encoding: seconds, not minutes, and zero quality loss.",
  },
];

const STEPS = [
  { title: "Drop in your clips", body: "Add as many videos as you like. They stay on your device." },
  { title: "Trim, split and arrange", body: "Cut out what you don't need and put the rest in order." },
  { title: "Export and download", body: "Get one stitched MP4, or every segment as its own file." },
];

// Clip blocks for the hero's timeline illustration.
const CLIPS = [
  { w: "w-[22%]", c: "from-[#8b7bff] to-[#6d5dfc]" },
  { w: "w-[31%]", c: "from-[#ff7ac6] to-[#e0569f]" },
  { w: "w-[18%]", c: "from-[#3ddc97] to-[#1fb67a]" },
  { w: "w-[25%]", c: "from-[#fbbf24] to-[#e79a0c]" },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-28 pb-10">
      <section className="grid items-center gap-12 pt-4 lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col items-start gap-6">
          <span className="badge">
            <span className="size-1.5 rounded-full bg-ok" /> Runs 100% in your browser
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Split, trim &amp; stitch videos. <span className="text-gradient">No uploads. No timeouts.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted text-pretty">
            A fast video editor that uses your own computer&apos;s power. Your files never leave your device, and exports
            never time out.
          </p>
          <div className="flex flex-wrap gap-3">
            <HardLink href="/editor" className="btn btn-primary btn-lg">
              Open the editor <ArrowRightIcon />
            </HardLink>
            <HardLink href="/pricing" className="btn btn-secondary btn-lg">
              See pricing
            </HardLink>
          </div>
          <p className="text-sm text-subtle">Free to use. No sign-up needed to start editing.</p>
        </div>

        <EditorMock />
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="Why Anti-Timeout" title="Everything you need to cut and join videos, nothing you don't." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card flex flex-col gap-3 p-6 transition-colors hover:border-line-strong">
              <span className="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand">
                <Icon size={20} />
              </span>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="How it works" title="Three steps. No learning curve." />
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card flex flex-col gap-3 p-6">
              <span className="font-mono text-sm text-brand">0{i + 1}</span>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card relative overflow-hidden px-6 py-12 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_16rem_at_50%_0%,rgb(139_123_255/0.22),transparent_70%)]" />
        <div className="relative flex flex-col items-center gap-5">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Need more than 3 clips or full HD?
          </h2>
          <p className="max-w-xl text-muted">
            Pro unlocks unlimited stitching and original-quality exports, billed monthly in naira. Cancel anytime.
          </p>
          <HardLink href="/pricing" className="btn btn-primary btn-lg">
            Upgrade to Pro <ArrowRightIcon />
          </HardLink>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <span className="text-sm font-medium text-brand">{eyebrow}</span>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
    </div>
  );
}

/** Decorative illustration of the editor: a preview and a timeline of clips. */
function EditorMock() {
  return (
    <div className="card relative p-3 shadow-2xl shadow-brand/10" aria-hidden="true">
      <div className="flex items-center gap-1.5 px-2 pb-3">
        <span className="size-2.5 rounded-full bg-surface-3" />
        <span className="size-2.5 rounded-full bg-surface-3" />
        <span className="size-2.5 rounded-full bg-surface-3" />
      </div>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-[linear-gradient(135deg,#1d1840,#2b1530_55%,#0f2a24)]">
        <div className="absolute inset-0 bg-[radial-gradient(20rem_12rem_at_30%_40%,rgb(139_123_255/0.45),transparent_70%)]" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid size-14 place-items-center rounded-full bg-white/15 backdrop-blur">
            <span className="ml-1 size-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-white" />
          </span>
        </div>
        <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-0.5 font-mono text-xs text-white/80">
          00:42.6
        </span>
      </div>
      <div className="relative mt-3 flex h-14 gap-1 rounded-xl bg-bg p-1.5">
        {CLIPS.map((clip, i) => (
          <div key={i} className={`${clip.w} rounded-md bg-gradient-to-b ${clip.c} opacity-90`} />
        ))}
        <div className="absolute inset-y-0 left-[46%] w-0.5 bg-white shadow-[0_0_12px_white]" />
      </div>
      <div className="mt-3 flex items-center justify-between px-1 text-xs text-subtle">
        <span>4 clips · 2:18</span>
        <span className="badge badge-pro">Exporting 64%</span>
      </div>
    </div>
  );
}
