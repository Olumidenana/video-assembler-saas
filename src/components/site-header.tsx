import { getViewer } from "@/lib/billing/account";
import { HardLink } from "./hard-link";
import { LogoMark } from "./icons";

export async function SiteHeader() {
  const { user, plan } = await getViewer();
  const initial = (user?.name ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <HardLink href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <LogoMark />
          <span className="hidden sm:inline">Anti-Timeout</span>
        </HardLink>

        <div className="flex items-center gap-1 sm:gap-2">
          <HardLink href="/editor" className="btn btn-ghost btn-sm">
            Editor
          </HardLink>
          <HardLink href="/pricing" className="btn btn-ghost btn-sm">
            Pricing
          </HardLink>
          {user ? (
            <HardLink href="/account" className="btn btn-secondary btn-sm pl-1.5" aria-label="Your account">
              {/* A letter avatar, not the Google photo: /editor blocks third-party images (COEP). */}
              <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-xs font-semibold text-white">
                {initial}
              </span>
              {plan === "pro" ? <span className="badge badge-pro h-5 px-2">Pro</span> : "Account"}
            </HardLink>
          ) : (
            <HardLink href="/login" className="btn btn-primary btn-sm">
              Sign in
            </HardLink>
          )}
        </div>
      </nav>
    </header>
  );
}
