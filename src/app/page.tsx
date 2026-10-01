import { existsSync } from "node:fs";
import { join } from "node:path";
import { HardLink } from "@/components/hard-link";
import {
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  LockIcon,
  ScissorsIcon,
  SparkIcon,
  SplitIcon,
  UploadIcon,
} from "@/components/icons";
import { ShowcasePhone } from "@/components/showcase";
import { SHOWCASE, type ShowcaseClip } from "@/components/showcase-data";
import { TypingCommand } from "@/components/typing-command";
import { PLAN_LIMITS } from "@/lib/plans";

// Rendered at build time, so this sees exactly the files that ship in /public.
const hasVideo = (clip: ShowcaseClip) => existsSync(join(process.cwd(), "public", clip.src));

const SIGNALS = [
  {
    emoji: "🪝",
    name: "Hook",
    body: "Viewers decide in the first 3 seconds. Bold claims, questions and pattern breaks score high.",
  },
  {
    emoji: "🧩",
    name: "Curiosity",
    body: "Open loops (“here’s the part nobody tells you…”) keep people watching to the payoff.",
  },
  {
    emoji: "🔥",
    name: "Emotion",
    body: "Laughter, surprise and strong opinions get shared. Loud reactions and energy count too.",
  },
  {
    emoji: "💡",
    name: "Value",
    body: "Tips, numbers and how-tos get saved, and saves tell the algorithm to push your clip.",
  },
  {
    emoji: "⚡",
    name: "Pacing",
    body: "No dead air. Clips are cut on sentence boundaries, so they never start or end mid-thought.",
  },
];

const CREATORS = [
  {
    emoji: "🎙️",
    title: "Clippers",
    body: "Turn a 2-hour podcast, stream or interview into ranked short clips. Hours of scrubbing become a few minutes.",
  },
  {
    emoji: "🎭",
    title: "Skit makers",
    body: "Find the punchline, cut the dead air and add word-by-word captions that keep people watching.",
  },
  {
    emoji: "🤖",
    title: "YouTube automation",
    body: "Faceless channels: repurpose long-form into Shorts in bulk, with titles, captions and hashtags written for you.",
  },
  {
    emoji: "📱",
    title: "Everyday creators",
    body: "Church services, events, classes and vlogs: post the best minute to Status, Reels and TikTok.",
  },
];

const STEPS = [
  { icon: UploadIcon, title: "Drop in a long video", body: "Podcast, stream, sermon, skit or vlog. It stays on your device." },
  { icon: SparkIcon, title: "AI finds the viral moments", body: "Every clip is scored on hook, curiosity, emotion, value and pacing." },
  { icon: BoltIcon, title: "Export ready-to-post clips", body: "Vertical 9:16, captioned, with a title, caption and hashtags." },
];

const FEATURES = [
  {
    icon: SparkIcon,
    title: "Viral Clip Finder",
    body: "Finds the moments most likely to perform, explains why, and writes the post for you.",
  },
  {
    icon: LayersIcon,
    title: "Auto-captions",
    body: "Word-by-word captions in styles that hold attention. Transcribed on your device, in English and many other languages.",
  },
  {
    icon: SplitIcon,
    title: "Reframe for every platform",
    body: "9:16 for Reels, TikTok, Shorts and Status, 1:1 for feeds, 16:9 for YouTube. Blurred fill or crop.",
  },
  {
    icon: ScissorsIcon,
    title: "Auto-edit",
    body: "Make a highlight of any length, remove silences, or just type what you want in plain English.",
  },
  {
    icon: LockIcon,
    title: "Private by design",
    body: "Your videos are processed in your browser. Nothing is uploaded, so nothing can leak.",
  },
  {
    icon: ClockIcon,
    title: "No timeouts, no queues",
    body: "Long videos never hit a server time limit, because there's no server doing the heavy lifting.",
  },
];

const PLANS = [
  {
    name: "Free",
    blurb: "Feel the magic",
    features: [
      "Your #1 viral clip from every video",
      `Captions on the first ${PLAN_LIMITS.free.captionSeconds}s`,
      "9:16 reframing, AI auto-edit",
      "Small watermark, 720p",
    ],
  },
  {
    name: "Pro",
    blurb: "Post every day",
    features: [
      `Top ${PLAN_LIMITS.pro.viralClipExports} viral clips per video`,
      "Captions on the whole video",
      "No watermark, full quality",
      "Unlimited stitching",
    ],
  },
  {
    name: "Studio",
    blurb: "The clipping machine",
    highlight: true,
    features: [
      "Unlimited viral clips + post kits",
      "All caption styles (Bold Pop, Karaoke…)",
      "Your logo on every export",
      "AI-written picks and titles",
    ],
  },
];

// Timeline blocks for the auto-edit illustration; `pick` ones light up as the AI "chooses" them.
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

const delay = (ms: number) => ({ ["--reveal-delay" as string]: `${ms}ms` });

export default function Home() {
  const [left, middle, right] = SHOWCASE;
  return (
    <div className="flex flex-col gap-28 pb-10 sm:gap-36">
      <section className="relative grid items-center gap-14 pt-2 lg:grid-cols-[1.1fr_1fr]">
        {/* Glows span the full viewport width but are clipped to it, so phones don't zoom out to fit them. */}
        <div className="pointer-events-none absolute -top-40 bottom-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden">
          <div className="absolute -top-20 left-[calc(50%-36rem)] size-[28rem] rounded-full bg-brand/25 blur-[120px] animate-drift" />
          <div className="absolute right-[calc(50%-34rem)] top-60 size-[24rem] rounded-full bg-brand-2/20 blur-[120px] animate-drift-slow" />
        </div>

        <div className="flex flex-col items-start gap-6">
          <span className="badge badge-pro">
            <SparkIcon size={13} /> New · Viral Clip Finder
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            One long video in. <span className="text-gradient">A week of viral clips out.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted text-pretty">
            Anti-Timeout watches your video like a top editor: it finds the moments with the strongest hooks, adds
            word-by-word captions, reframes them for Reels, TikTok and Shorts, and scores every clip&apos;s viral
            potential. All in your browser.
          </p>
          <div className="flex flex-wrap gap-3">
            <HardLink href="/editor" className="btn btn-primary btn-lg">
              Find my viral clips, free <ArrowRightIcon />
            </HardLink>
            <HardLink href="/pricing" className="btn btn-secondary btn-lg">
              See pricing
            </HardLink>
          </div>
          <p className="flex items-center gap-2 text-sm text-subtle">
            <LockIcon size={14} /> No sign-up needed · Your videos never leave your device
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
          <div className="absolute left-2 top-10 w-[44%] -rotate-[8deg] opacity-80">
            <ShowcasePhone clip={left} hasVideo={hasVideo(left)} />
          </div>
          <div className="absolute right-2 top-10 w-[44%] rotate-[8deg] opacity-80">
            <ShowcasePhone clip={right} hasVideo={hasVideo(right)} />
          </div>
          <div className="relative z-10 mx-auto w-[58%] animate-float">
            <ShowcasePhone clip={middle} hasVideo={hasVideo(middle)} priority className="shadow-brand/30" />
            <span className="absolute -right-3 top-16 rounded-xl border border-line bg-surface/90 px-3 py-2 text-xs shadow-xl backdrop-blur sm:-right-16">
              <span className="block text-subtle">Hook</span>
              <span className="font-mono text-base font-semibold text-ok">97</span>
            </span>
            <span className="absolute -left-3 top-1/3 rounded-xl border border-line bg-surface/90 px-3 py-2 text-xs shadow-xl backdrop-blur sm:-left-16">
              <span className="block text-subtle">Clips found</span>
              <span className="font-mono text-base font-semibold">10</span>
            </span>
          </div>
        </div>
      </section>

      <section className="reveal grid gap-4 md:grid-cols-2">
        <div className="card flex flex-col gap-3 p-6 sm:p-8">
          <span className="text-sm font-medium text-subtle">The old way</span>
          <p className="text-xl font-semibold">Scrub through hours of footage, guess what will hit, caption by hand.</p>
          <p className="text-sm text-muted">
            Upload to a slow website, wait in a queue, and watch it time out halfway through your 2-hour video.
          </p>
        </div>
        <div className="card relative flex flex-col gap-3 overflow-hidden border-brand/40 p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-brand/25 blur-3xl" />
          <span className="relative text-sm font-medium text-brand">With Anti-Timeout</span>
          <p className="relative text-xl font-semibold">Drop the video in. Get ranked, captioned, vertical clips in minutes.</p>
          <p className="relative text-sm text-muted">
            Nothing to upload, no queue, no time limit. Your device does the work, so a 2-hour video is no problem.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading
          eyebrow="Content psychology, built in"
          title="Every clip is scored on the five things that make people stop scrolling."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SIGNALS.map((s, i) => (
            <div key={s.name} className="reveal card relative flex flex-col gap-3 overflow-hidden p-5" style={delay(i * 90)}>
              <span className="text-2xl">{s.emoji}</span>
              <h3 className="font-medium">{s.name}</h3>
              <p className="text-sm leading-relaxed text-muted">{s.body}</p>
              <span className="mt-auto h-1 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full w-full origin-left rounded-full bg-gradient-to-r from-brand to-brand-2 animate-bar" style={{ animationDelay: `${i * 0.2}s` }} />
              </span>
            </div>
          ))}
        </div>
        <p className="reveal max-w-2xl text-sm text-subtle">
          Each pick comes with the reasons behind its score, a title, a caption and hashtags. On Studio, AI re-reads the
          whole transcript to pick and write like a seasoned clipper. Scores are a guide, not a promise: your audience
          decides.
        </p>
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="Made for" title="Clippers, skit makers, faceless channels, and everyone in between." />
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="reveal mx-auto flex w-full max-w-sm gap-3 lg:order-2 lg:max-w-none" aria-hidden="true">
            {SHOWCASE.map((clip, i) => (
              <ShowcasePhone key={clip.src} clip={clip} hasVideo={hasVideo(clip)} className={i === 1 ? "lg:-translate-y-6" : ""} />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {CREATORS.map((c, i) => (
              <div key={c.title} className="reveal card flex flex-col gap-2 p-5" style={delay((i % 2) * 100)}>
                <span className="text-2xl">{c.emoji}</span>
                <h3 className="font-medium">{c.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid items-center gap-12 lg:grid-cols-2">
        <div className="reveal flex flex-col gap-5">
          <p className="text-sm font-medium text-brand">Just tell it what you want</p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">An editor that takes instructions.</h2>
          <TypingCommand />
          <p className="text-muted">
            Ask for a highlight of any length, remove the silences, cut the intro, split for Status, reorder clips or
            export, in plain English.
          </p>
        </div>
        <HeroEditor />
      </section>

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="How it works" title="From raw footage to ready-to-post in three steps." />
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="reveal card relative flex flex-col gap-4 overflow-hidden p-6" style={delay(i * 120)}>
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
        <SectionHeading eyebrow="Features" title="Everything a creator needs to repurpose video, nothing they don't." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="reveal card group flex flex-col gap-3 p-6 transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-brand/40"
              style={delay((i % 3) * 100)}
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

      <section className="flex flex-col gap-10">
        <SectionHeading eyebrow="Plans" title="Start free. Upgrade when the clips start working." />
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <div
              key={plan.name}
              className={`reveal card relative flex flex-col gap-4 overflow-hidden p-6 ${plan.highlight ? "border-brand/50 shadow-xl shadow-brand/15" : ""}`}
              style={delay(i * 100)}
            >
              {plan.highlight && <div className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-brand-2/20 blur-3xl" />}
              <div className="relative flex items-center justify-between">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <span className={`badge ${plan.highlight ? "badge-pro" : ""}`}>{plan.blurb}</span>
              </div>
              <ul className="relative flex flex-col gap-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <CheckIcon size={16} className="mt-0.5 shrink-0 text-ok" /> <span className="text-muted">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <HardLink href="/pricing" className="reveal btn btn-secondary self-start">
          See prices in naira <ArrowRightIcon />
        </HardLink>
      </section>

      <section className="reveal card relative overflow-hidden px-6 py-14 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_16rem_at_50%_0%,rgb(139_123_255/0.25),transparent_70%)]" />
        <div className="pointer-events-none absolute -bottom-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-brand-2/15 blur-3xl animate-drift" />
        <div className="relative flex flex-col items-center gap-5">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Your next viral clip is already in your camera roll.</h2>
          <p className="max-w-xl text-muted">
            Drop in any long video and see its best moments, scored and captioned, in a few minutes. Free, no sign-up.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <HardLink href="/editor" className="btn btn-primary btn-lg">
              Find my viral clips <ArrowRightIcon />
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
