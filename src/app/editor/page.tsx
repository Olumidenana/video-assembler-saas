import type { Metadata } from "next";
import { HardLink } from "@/components/hard-link";
import { getViewer } from "@/lib/billing/account";
import { EditorLoader } from "./editor-loader";

export const metadata: Metadata = { title: "Editor · Anti-Timeout" };

export default async function EditorPage({ searchParams }: PageProps<"/editor">) {
  const [{ plan }, params] = await Promise.all([getViewer(), searchParams]);
  const welcome = params.welcome === "pro" && plan === "pro";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Editor</h1>
          <p className="text-sm text-muted">Everything happens on this device. Nothing is uploaded.</p>
        </div>
        {plan === "pro" ? (
          <span className="badge badge-pro">Pro · unlimited clips, full resolution</span>
        ) : (
          <HardLink href="/pricing" className="badge transition-colors hover:border-line-strong hover:text-fg">
            Free plan · Upgrade for full HD
          </HardLink>
        )}
      </div>
      {welcome && (
        <p className="notice notice-ok" role="status">
          Welcome to Pro! Unlimited stitching and full-resolution exports are now unlocked.
        </p>
      )}
      <EditorLoader plan={plan} />
    </div>
  );
}
