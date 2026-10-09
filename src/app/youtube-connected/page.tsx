import type { Metadata } from "next";
import { ConnectedNotice } from "./notice";

export const metadata: Metadata = { title: "YouTube · AuraCut" };

const MESSAGES: Record<string, string> = {
  ok: "Your YouTube channel is connected. You can close this window and post from the editor.",
  denied: "You didn't allow posting, so nothing was connected.",
  upgrade: "Posting straight to YouTube is part of Studio.",
  not_configured: "YouTube posting isn't set up on this site yet.",
  sign_in: "Sign in first, then connect YouTube from the editor.",
  state: "That link expired. Start again from the editor.",
  failed: "Connecting YouTube didn't work. Please try again.",
};

/** Where the YouTube connection popup lands: tells the editor tab, then closes. */
export default async function YouTubeConnected({ searchParams }: PageProps<"/youtube-connected">) {
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
