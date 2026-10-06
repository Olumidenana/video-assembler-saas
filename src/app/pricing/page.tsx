import type { Metadata } from "next";
import { HardLink } from "@/components/hard-link";
import { CheckIcon, LockIcon, SparkIcon } from "@/components/icons";
import { getViewer, type Viewer } from "@/lib/billing/account";
import { formatMoney, intervalLabel } from "@/lib/billing/format";
import { getPlan, type PaystackPlan } from "@/lib/billing/paystack";
import { PLAN_LIMITS, PLAN_RANK, type PaidPlanId } from "@/lib/plans";
import { CheckoutButton } from "./checkout-button";

export const metadata: Metadata = { title: "Pricing · Anti-Timeout" };

const FREE = [
  `Stitch up to ${PLAN_LIMITS.free.maxStitchClips} videos together`,
  "AI best moments & silence removal",
  `Auto-captions on the first ${PLAN_LIMITS.free.captionSeconds}s`,
  "Find viral clips and export the top one",
  `Beat-synced edits & mashups of ${PLAN_LIMITS.free.mashupVideos} videos`,
  `Exports up to ${PLAN_LIMITS.free.maxShortSide}p, with a small watermark`,
];

const PRO = [
  "No watermark",
  "Full HD and original-quality exports",
  "Stitch unlimited videos",
  "Auto-captions on the whole video",
  `Export the top ${PLAN_LIMITS.pro.viralClipExports} viral clips per video`,
  `Clip Pack: ${PLAN_LIMITS.pro.packClips} finished posts in one click`,
  `Edits & mashups of up to ${PLAN_LIMITS.pro.mashupVideos} videos`,
  "AI picks the best moments from the whole transcript",
  "Follow the speaker: vertical crops that keep the face in frame",
  "Everything in Free",
];

const STUDIO = [
  "Unlimited viral clips from every video",
  "AI Vision: watches your clips, picks the best & writes the hooks",
  `AI Theme Match: edits of up to ${PLAN_LIMITS.studio.mashupVideos} videos built around a story`,
  `Clip Pack: ${PLAN_LIMITS.studio.packClips} posts at once, shared straight to your apps`,
  "Post and schedule straight to YouTube Shorts",
  "Viral score: hook, curiosity, emotion & payoff",
  "Post kit: titles, captions & hashtags per clip",
  "All caption styles (word-by-word, bold pop, karaoke)",
  "Your logo on every export",
  "Everything in Pro",
];

// This page is not cross-origin isolated (see next.config.ts), so Paystack's popup can load here.
export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const [viewer, pro, studio, params] = await Promise.all([getViewer(), getPlan("pro"), getPlan("studio"), searchParams]);
  const reference = typeof params.reference === "string" ? params.reference : undefined;

  return (
    <div className="flex flex-col items-center gap-12">
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <span className="text-sm font-medium text-brand">Pricing</span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Priced in naira. <span className="text-gradient">Built for creators.</span>
        </h1>
        <p className="text-lg text-muted">Start free. Upgrade when you&apos;re posting every day.</p>
      </div>

      <div className="grid w-full max-w-6xl gap-5 lg:grid-cols-3">
        <Tier name="Free" price={pro ? formatMoney(0, pro.currency) : "₦0"} per="forever" blurb="Feel the magic on short videos." features={FREE}>
          <HardLink href="/editor" className="btn btn-secondary btn-lg w-full">
            Start free
          </HardLink>
        </Tier>

        <Tier name="Pro" plan={pro} blurb="For editing without limits." features={PRO}>
          <Action tier="pro" plan={pro} viewer={viewer} reference={reference} variant="secondary" />
        </Tier>

        <Tier
          name="Studio"
          plan={studio}
          blurb="Turn long videos into a week of viral posts."
          features={STUDIO}
          featured
          badge="Best for creators"
        >
          <Action tier="studio" plan={studio} viewer={viewer} reference={reference} />
        </Tier>
      </div>

      <div className="card flex max-w-3xl flex-col gap-2 p-6 text-center">
        <p className="flex items-center justify-center gap-2 font-medium">
          <SparkIcon size={16} className="text-brand" /> Made for clippers, YouTube automation, skit makers, podcasters &amp; churches
        </p>
        <p className="text-sm text-muted">
          Drop in a 1-hour video and get a stack of short, captioned, ready-to-post clips, scored for how likely they
          are to hold attention. No uploading gigabytes on expensive data: it all runs on your device.
        </p>
      </div>

      <p className="flex items-center gap-2 text-center text-sm text-subtle">
        <LockIcon size={15} /> Secure card payments by Paystack. Renews monthly; cancel anytime from your account.
      </p>
    </div>
  );
}

function Tier({
  name,
  plan,
  price,
  per,
  blurb,
  features,
  featured = false,
  badge,
  children,
}: {
  name: string;
  plan?: PaystackPlan | null;
  price?: string;
  per?: string;
  blurb: string;
  features: string[];
  featured?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const shownPrice = price ?? (plan ? formatMoney(plan.amount, plan.currency) : null);
  const shownPer = per ?? (plan ? intervalLabel(plan.interval) : null);
  const body = (
    <div className={`flex h-full flex-col gap-6 rounded-2xl p-7 ${featured ? "bg-surface" : ""}`}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{name}</h2>
          {badge && <span className="badge badge-pro">{badge}</span>}
        </div>
        <p className="text-4xl font-semibold tracking-tight">
          {shownPrice ?? <span className="text-2xl text-muted">Coming soon</span>}
          {shownPrice && shownPer && <span className="text-base font-normal text-muted"> / {shownPer}</span>}
        </p>
        <p className="text-sm text-muted">{blurb}</p>
      </div>
      <ul className="flex flex-col gap-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                featured ? "bg-brand/20 text-brand" : "bg-surface-3 text-muted"
              }`}
            >
              <CheckIcon size={12} strokeWidth={2.5} />
            </span>
            <span className={featured ? "text-fg" : "text-muted"}>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto">{children}</div>
    </div>
  );

  return featured ? (
    <div className="relative rounded-2xl bg-gradient-to-b from-brand/80 via-brand-2/40 to-transparent p-px shadow-2xl shadow-brand/20 lg:-my-3">
      {body}
    </div>
  ) : (
    <div className="card">{body}</div>
  );
}

function Action({
  tier,
  plan,
  viewer,
  reference,
  variant = "primary",
}: {
  tier: PaidPlanId;
  plan: PaystackPlan | null;
  viewer: Viewer;
  reference?: string;
  variant?: "primary" | "secondary";
}) {
  const label = PLAN_LIMITS[tier].label;
  if (viewer.plan === tier) {
    return (
      <div className="flex flex-col gap-3">
        <p className="notice notice-ok">You&apos;re on {label}. Thank you!</p>
        <HardLink href="/account" className="btn btn-secondary btn-lg w-full">
          Manage subscription
        </HardLink>
      </div>
    );
  }
  if (PLAN_RANK[viewer.plan] > PLAN_RANK[tier]) {
    return <p className="notice notice-info">Included in your {PLAN_LIMITS[viewer.plan].label} plan.</p>;
  }
  if (!viewer.user) {
    return (
      <HardLink href="/login?next=/pricing" className={`btn btn-${variant} btn-lg w-full`}>
        Sign in to get {label}
      </HardLink>
    );
  }
  if (!plan) return <p className="notice notice-info">Coming soon.</p>;
  const price = formatMoney(plan.amount, plan.currency);
  return (
    <CheckoutButton
      tier={tier}
      variant={variant}
      label={viewer.plan === "pro" && tier === "studio" ? `Upgrade to Studio · ${price}` : `Get ${label} · ${price}`}
      returnReference={reference}
    />
  );
}
