"use client";

import { useEffect } from "react";

/**
 * Notifies the editor tab when TikTok authentication finishes via BroadcastChannel.
 */
export function ConnectedNotice({ ok }: { ok: boolean }) {
  useEffect(() => {
    const channel = new BroadcastChannel("tiktok");
    channel.postMessage({ connected: ok });
    channel.close();
    if (ok) setTimeout(() => window.close(), 1200);
  }, [ok]);
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.close()}>
      Close this window
    </button>
  );
}
