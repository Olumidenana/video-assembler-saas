import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { getViewer } from "@/lib/billing/account";
import { safeNextPath } from "@/lib/billing/status";
import { supabaseConfigured } from "@/lib/env";
import { GoogleButton } from "./google-button";

export const metadata: Metadata = { title: "Sign in · AuraCut" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const { user } = await getViewer();
  if (user) redirect(next);

  return (
    <div className="flex justify-center py-6 sm:py-12">
      <div className="card flex w-full max-w-md flex-col gap-7 p-8 sm:p-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark size={44} />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to AuraCut</h1>
            <p className="text-sm text-muted">Sign in to upgrade to Pro and keep your plan on every device.</p>
          </div>
        </div>

        {params.error && (
          <p className="notice notice-danger" role="alert">
            Sign-in didn&apos;t complete. Please try again.
          </p>
        )}

        {supabaseConfigured ? (
          <GoogleButton next={next} />
        ) : (
          <p className="notice notice-warn">Sign-in isn&apos;t configured yet (missing Supabase settings).</p>
        )}

        <p className="text-center text-xs text-subtle">
          You don&apos;t need an account to edit videos. By signing in you agree to our{" "}
          <a href="/terms" className="underline hover:text-fg">Terms</a> and{" "}
          <a href="/privacy" className="underline hover:text-fg">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
