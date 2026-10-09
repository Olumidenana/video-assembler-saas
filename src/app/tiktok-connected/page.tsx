import type { Metadata } from "next";
import { ConnectedNotice } from "./notice";

export const metadata: Metadata = { title: "TikTok · Anti-Timeout" };

const MESSAGES: Record<string, string> = {
  ok: "Your TikTok account is connected. You can close this window and post from the editor.",
  denied: "You didn't allow posting, so nothing was connected.",
  upgrade: "Posting straight to TikTok is part of Studio.",
  not_configured: "TikTok posting isn't set up on this site yet.",
  sign_in: "Sign in first, then connect TikTok from the editor.",
  state: "That link expired. Start again from the editor.",
  failed: "Connecting TikTok didn't work. Please try again.",
};

/** Where the TikTok connection popup lands: notifies the editor tab via BroadcastChannel, then closes. */
export default async function TikTokConnected({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const params = await searchParams;
  const ok = params.ok === "1";
  const error = typeof params.error === "string" ? params.error : null;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="text-4xl" aria-hidden>
        {ok ? "✅" : "⚠️"}
      </span>
      <p className="text-lg">{ok ? MESSAGES.ok : MESSAGES[error ?? "failed"] ?? MESSAGES.failed}</p>
      <ConnectedNotice ok={ok} />
    </div>
  );
}
