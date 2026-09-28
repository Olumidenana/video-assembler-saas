import type { AnchorHTMLAttributes } from "react";

/**
 * A plain <a> that always triggers a full document load.
 *
 * Use this (not next/link) for any navigation that crosses the boundary
 * between /editor (cross-origin isolated) and the rest of the site. COOP/COEP
 * are applied per document, so a client-side route change would leave the
 * editor without SharedArrayBuffer, or leave /pricing isolated and break the
 * Paystack popup.
 */
export function HardLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
