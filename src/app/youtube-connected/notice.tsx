"use client";

import { useEffect } from "react";

/**
 * Tells the editor tab the result. The editor is cross-origin isolated, so
 * this popup has no opener to message; a BroadcastChannel reaches every tab
 * of this site instead.
 */
export function ConnectedNotice({ ok }: { ok: boolean }) {
  useEffect(() => {
    const channel = new BroadcastChannel("youtube");
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
