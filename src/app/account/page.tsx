import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HardLink } from "@/components/hard-link";
import { getViewer } from "@/lib/billing/account";
import { formatDate } from "@/lib/billing/format";
import { PLAN_LIMITS } from "@/lib/plans";

export const metadata: Metadata = { title: "Account · Anti-Timeout" };

const ERRORS: Record<string, string> = {
  manage: "We couldn't open the subscription page. Please try again in a moment.",
  "no-subscription": "Your subscription is still being set up. Please try again in a few minutes.",
};

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const [{ user, subscription, plan }, params] = await Promise.all([getViewer(), searchParams]);
  if (!user) redirect("/login?next=/account");

  const pro = plan === "pro";
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const periodEnd = subscription?.current_period_end ? formatDate(subscription.current_period_end) : null;
  const renewal =
    subscription?.status === "non-renewing"
      ? `Cancelled. Pro stays active until ${periodEnd}.`
      : subscription?.status === "attention"
        ? `Your last renewal payment failed. Update your card to keep Pro after ${periodEnd}.`
        : periodEnd
          ? `Renews on ${periodEnd}.`
          : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Account</h1>

      {error && (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      )}

      <section className="card flex items-center gap-4 p-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-lg font-semibold text-white">
          {(user.name ?? user.email).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          {user.name && <p className="truncate font-medium">{user.name}</p>}
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </section>

      <section className="card flex flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="text-2xl font-semibold">{pro ? "Pro" : "Free"}</p>
          </div>
          <span className={pro ? "badge badge-pro" : "badge"}>{pro ? "Active" : "Free plan"}</span>
        </div>

        <p className="text-sm text-muted">
          {pro
            ? "Unlimited stitching and original-quality exports."
            : `Up to ${PLAN_LIMITS.free.maxStitchClips} videos per stitch and ${PLAN_LIMITS.free.maxShortSide}p exports.`}
        </p>
        {pro && renewal && <p className="text-sm text-muted">{renewal}</p>}

        <div className="flex flex-wrap gap-3">
          {pro ? (
            subscription?.paystack_subscription_code && (
              <form action="/api/billing/manage" method="post">
                <button type="submit" className="btn btn-secondary">
                  Update card or cancel
                </button>
              </form>
            )
          ) : (
            <HardLink href="/pricing" className="btn btn-primary">
              Upgrade to Pro
            </HardLink>
          )}
          <HardLink href="/editor" className="btn btn-ghost">
            Open the editor
          </HardLink>
        </div>
      </section>

      <form action="/auth/signout" method="post" className="self-start">
        <button type="submit" className="btn btn-ghost">
          Sign out
        </button>
      </form>
    </div>
  );
}
