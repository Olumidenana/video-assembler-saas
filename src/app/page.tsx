import { HardLink } from "@/components/hard-link";
import {
  ArrowRightIcon,
  BoltIcon,
  ClockIcon,
  LayersIcon,
  LockIcon,
  ScissorsIcon,
  SparkIcon,
  SplitIcon,
  UploadIcon,
} from "@/components/icons";
import { TypingCommand } from "@/components/typing-command";

const FEATURES = [
  {
    icon: SparkIcon,
    title: "AI finds the best moments",
    body: "It listens for speech, laughter and music and watches for action, then keeps only the parts worth watching.",
  },
  {
    icon: ScissorsIcon,
    title: "Removes silences automatically",
    body: "Pauses, dead air and 'umm' gaps disappear in one click. Perfect for talking-head videos and voice notes.",
  },
  {
    icon: LayersIcon,
    title: "Stitch anything together",
    body: "Portrait, landscape, MP4, MOV, WebM, with or without sound. Everything joins into one clean MP4.",
  },
  {
    icon: SplitIcon,
    title: "Split for Status, Reels & Shorts",
    body: "Chop a long video into 15, 30 or 60-second parts ready to post, in one step.",
  },
  {
    icon: LockIcon,
    title: "Private by design",
    body: "Your videos are processed on your own device. Nothing is uploaded, so nothing can leak.",
  },
  {
    icon: ClockIcon,
    title: "No timeouts, no queues",
    body: "Long videos never hit a server time limit, because there's no server doing the heavy lifting.",
  },
];

const STEPS = [
  { icon: UploadIcon, title: "Drop in your videos", body: "Add one or many. They stay on your device." },
  { icon: SparkIcon, title: "Let AI edit, or tell it what to do", body: "“Make a 30s highlight.” Done in seconds." },
  { icon: BoltIcon, title: "Export and share", body: "One stitched MP4, or every part as its own file." },
];

const USE_CASES = ["WhatsApp Status", "Instagram Reels", "YouTube Shorts", "TikTok", "Podcast clips", "Event recaps", "Church & school events", "Product demos"];

// Timeline blocks for the hero illustration; `pick` ones light up as the AI "chooses" them.
const CLIPS = [
  { w: "w-[14%]", c: "from-[#8b7bff] to-[#6d5dfc]", pick: false },
  { w: "w-[18%]", c: "from-[#ff7ac6] to-[#e0569f]", pick: true, delay: "0s" },
  { w: "w-[12%]", c: "from-[#5cc8ff] to-[#2e9fe0]", pick: false },
  { w: "w-[20%]", c: "from-[#3ddc97] to-[#1fb67a]", pick: true, delay: "1.6s" },
  { w: "w-[11%]", c: "from-[#c084fc] to-[#9d5cf0]", pick: false },
  { w: "w-[17%]", c: "from-[#fbbf24] to-[#e79a0c]", pick: true, delay: "3.2s" },
];

const BARS = Array.from({ length: 36 }, (_, i) => ({
  h: 30 + ((i * 37) % 70),
  d: `${(i % 9) * 0.11}s`,
}));

export default function Home() {
  return (
    <div className="flex flex-col gap-28 pb-10 sm:gap-36">
      <section className="relative grid items-center gap-12 pt-2 lg:grid-cols-[1.05fr_1fr]">
        <div className="pointer-events-none absolute -left-40 -top-40 -z-10 size-[28rem] rounded-full bg-brand/25 blur-[120px] animate-drift" />
        <div className="pointer-events-none absolute -right-32 top-20 -z-10 size-[24rem] rounded-full bg-brand-2/20 blur-[120px] animate-drift-slow" />

        <div className="flex flex-col items-start gap-6">
          <span className="badge badge-pro">
            <SparkIcon size={13} /> New · AI Auto-edit
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Drop in your videos. <span className="text-gradient">AI cuts the best parts.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted text-pretty">
            Anti-Timeout finds the highlights, removes the silences and stitches everything together, right in your
            browser. No uploads, no waiting, no editing skills needed.
          </p>
          <div className="flex flex-wrap gap-3">
            <HardLink href="/editor" className="btn btn-primary btn-lg">
              Start editing free <ArrowRightIcon />
            </HardLink>
            <HardLink href="/pricing" className="btn btn-secondary btn-lg">
              See pricing
            </HardLink>
          </div>
          <p className="flex items-center gap-2 text-sm text-subtle">
            <LockIcon size={14} /> No sign-up needed · Your videos never leave your device
          </p>
        </div>

        <HeroEditor />
      </section>

      <section className="reveal flex flex-col items-center gap-6 text-center">
        <p className="text-sm font-medium text-brand">Just tell it what you want</p>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Type a request. The editor does the rest.
        </h2>
        <div className="w-full max-w-2xl">
          <TypingCommand />
        </div>
        <p className="max-w-xl text-muted">
          Ask for a highlight of any length, cut the intro, split for Status, reorder clips, or export, all in plain
          English.
        </p>
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="How it works" title="From raw footage to ready-to-post in three steps." />
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="reveal card relative flex flex-col gap-4 overflow-hidden p-6" style={{ ["--reveal-delay" as string]: `${i * 120}ms` }}>
              <span className="absolute right-5 top-4 font-mono text-5xl font-semibold text-white/[0.04]">0{i + 1}</span>
              <span className="grid size-11 place-items-center rounded-xl bg-brand/12 text-brand">
                <Icon size={20} />
              </span>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="Features" title="Everything you need to cut and join videos, nothing you don't." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="reveal card group flex flex-col gap-3 p-6 transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-brand/40"
              style={{ ["--reveal-delay" as string]: `${(i % 3) * 100}ms` }}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand transition-transform duration-300 group-hover:scale-110">
                <Icon size={20} />
              </span>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="reveal flex flex-col items-center gap-6 text-center">
        <p className="text-sm font-medium text-brand">Made for</p>
        <div className="flex max-w-3xl flex-wrap justify-center gap-2.5">
          {USE_CASES.map((u) => (
            <span key={u} className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted">
              {u}
            </span>
          ))}
        </div>
      </section>

      <section className="reveal card relative overflow-hidden px-6 py-14 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_16rem_at_50%_0%,rgb(139_123_255/0.25),transparent_70%)]" />
        <div className="pointer-events-none absolute -bottom-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-brand-2/15 blur-3xl animate-drift" />
        <div className="relative flex flex-col items-center gap-5">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Your next video is 30 seconds away.</h2>
          <p className="max-w-xl text-muted">
            Free for quick edits. Pro unlocks unlimited stitching and full-quality exports, billed monthly in naira.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <HardLink href="/editor" className="btn btn-primary btn-lg">
              Open the editor <ArrowRightIcon />
            </HardLink>
            <HardLink href="/pricing" className="btn btn-secondary btn-lg">
              Compare plans
            </HardLink>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="reveal flex max-w-2xl flex-col gap-3">
      <span className="text-sm font-medium text-brand">{eyebrow}</span>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
    </div>
  );
}

/** Animated illustration: a playhead sweeps the timeline and the AI "picks" clips as it goes. */
function HeroEditor() {
  return (
    <div className="relative animate-float" aria-hidden="true">
      <div className="card relative p-3 shadow-2xl shadow-brand/20">
        <div className="flex items-center justify-between px-2 pb-3">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-1 text-[11px] font-medium text-[#c4bbff]">
            <SparkIcon size={11} /> Finding best moments…
          </span>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-xl bg-[linear-gradient(135deg,#1d1840,#2b1530_55%,#0f2a24)]">
          <div className="absolute inset-0 bg-[radial-gradient(20rem_12rem_at_30%_40%,rgb(139_123_255/0.5),transparent_70%)] animate-drift" />
          <div className="absolute inset-0 bg-[radial-gradient(14rem_10rem_at_75%_70%,rgb(255_122_198/0.35),transparent_70%)] animate-drift-slow" />
          <div className="absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-white/15 backdrop-blur">
              <span className="ml-1 size-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-white" />
            </span>
          </div>
          <div className="absolute inset-x-4 bottom-3 flex h-10 items-end gap-[3px]">
            {BARS.map((b, i) => (
              <span
                key={i}
                className="flex-1 origin-bottom rounded-full bg-white/50 animate-bar"
                style={{ height: `${b.h}%`, animationDelay: b.d }}
              />
            ))}
          </div>
        </div>

        <div className="relative mt-3 flex h-14 gap-1 rounded-xl bg-bg p-1.5">
          {CLIPS.map((clip, i) => (
            <div
              key={i}
              className={`${clip.w} rounded-md bg-gradient-to-b ${clip.c} ${clip.pick ? "animate-pick" : "opacity-45"}`}
              style={clip.pick ? { animationDelay: clip.delay } : undefined}
            />
          ))}
          <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_12px_white] animate-playhead" />
        </div>

        <div className="mt-3 flex items-center justify-between px-1 text-xs text-subtle">
          <span>6 clips · 4:12 of footage</span>
          <span className="badge badge-pro">30s highlight</span>
        </div>
      </div>
    </div>
  );
}
