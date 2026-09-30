import type { Metadata } from "next";
import { HardLink } from "@/components/hard-link";
import { CheckIcon, LockIcon } from "@/components/icons";
import { getViewer } from "@/lib/billing/account";
import { formatMoney, intervalLabel } from "@/lib/billing/format";
import { getPlan } from "@/lib/billing/paystack";
import { PLAN_LIMITS } from "@/lib/plans";
import { CheckoutButton } from "./checkout-button";

export const metadata: Metadata = { title: "Pricing · Anti-Timeout" };

const FREE_FEATURES = [
  `Stitch up to ${PLAN_LIMITS.free.maxStitchClips} videos together`,
  `Exports up to ${PLAN_LIMITS.free.maxShortSide}p`,
  "Unlimited trimming and splitting",
  "Split into parts for Status / Reels",
  "100% private, in-browser processing",
];

const PRO_FEATURES = [
  "Stitch unlimited videos together",
  "Original-quality exports, up to 4K",
  "Everything in Free",
  "Support a small independent tool",
];

// This page is not cross-origin isolated (see next.config.ts), so Paystack's popup can load here.
export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const [viewer, plan, params] = await Promise.all([getViewer(), getPlan(), searchParams]);
  const reference = typeof params.reference === "string" ? params.reference : undefined;
  const price = plan ? formatMoney(plan.amount, plan.currency) : null;

  return (
    <div className="flex flex-col items-center gap-12">
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <span className="text-sm font-medium text-brand">Pricing</span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Simple pricing. <span className="text-gradient">Cancel anytime.</span>
        </h1>
        <p className="text-lg text-muted">Start free. Upgrade when you need more clips or full resolution.</p>
      </div>

      <div className="grid w-full max-w-4xl gap-5 md:grid-cols-2">
        <div className="card flex flex-col gap-6 p-7">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Free</h2>
            <p className="text-4xl font-semibold tracking-tight">
              {plan ? formatMoney(0, plan.currency) : "₦0"}
              <span className="text-base font-normal text-muted"> / forever</span>
            </p>
            <p className="text-sm text-muted">For quick edits and short clips.</p>
          </div>
          <FeatureList items={FREE_FEATURES} />
          <HardLink href="/editor" className="btn btn-secondary btn-lg mt-auto w-full">
            Open the editor
          </HardLink>
        </div>

        <div className="relative rounded-2xl bg-gradient-to-b from-brand/70 via-brand-2/30 to-transparent p-px shadow-2xl shadow-brand/15">
          <div className="flex h-full flex-col gap-6 rounded-2xl bg-surface p-7">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">Pro</h2>
                <span className="badge badge-pro">Most popular</span>
              </div>
              <p className="text-4xl font-semibold tracking-tight">
                {price ?? "—"}
                {plan && <span className="text-base font-normal text-muted"> / {intervalLabel(plan.interval)}</span>}
              </p>
              <p className="text-sm text-muted">For creators who stitch long videos in full quality.</p>
            </div>
            <FeatureList items={PRO_FEATURES} highlight />
            <div className="mt-auto">
              <ProAction viewer={viewer} planReady={Boolean(plan)} price={price} reference={reference} />
            </div>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-2 text-sm text-subtle">
        <LockIcon size={15} /> Secure card payments by Paystack. Renews automatically; cancel anytime from your account.
      </p>
    </div>
  );
}

function ProAction({
  viewer,
  planReady,
  price,
  reference,
}: {
  viewer: Awaited<ReturnType<typeof getViewer>>;
  planReady: boolean;
  price: string | null;
  reference?: string;
}) {
  if (viewer.plan === "pro") {
    return (
      <div className="flex flex-col gap-3">
        <p className="notice notice-ok">You&apos;re on Pro. Thanks for your support!</p>
        <HardLink href="/account" className="btn btn-secondary btn-lg w-full">
          Manage subscription
        </HardLink>
      </div>
    );
  }
  if (!viewer.user) {
    return (
      <HardLink href="/login?next=/pricing" className="btn btn-primary btn-lg w-full">
        Sign in to upgrade
      </HardLink>
    );
  }
  if (!planReady) {
    return <p className="notice notice-info">Payments are being set up. Please check back soon.</p>;
  }
  return <CheckoutButton label={`Upgrade for ${price}`} returnReference={reference} />;
}

function FeatureList({ items, highlight = false }: { items: string[]; highlight?: boolean }) {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
              highlight ? "bg-brand/20 text-brand" : "bg-surface-3 text-muted"
            }`}
          >
            <CheckIcon size={12} strokeWidth={2.5} />
          </span>
          <span className={highlight ? "text-fg" : "text-muted"}>{item}</span>
        </li>
      ))}
    </ul>
  );
}
