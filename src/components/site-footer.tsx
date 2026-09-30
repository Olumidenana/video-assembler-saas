import { HardLink } from "./hard-link";
import { LogoMark } from "./icons";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-subtle sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <LogoMark size={20} />
          <span>Anti-Timeout · videos never leave your device</span>
        </div>
        <div className="flex gap-5">
          <HardLink href="/editor" className="hover:text-fg">
            Editor
          </HardLink>
          <HardLink href="/pricing" className="hover:text-fg">
            Pricing
          </HardLink>
          <HardLink href="/account" className="hover:text-fg">
            Account
          </HardLink>
        </div>
      </div>
    </footer>
  );
}
