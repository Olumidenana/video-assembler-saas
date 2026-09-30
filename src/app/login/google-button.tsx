"use client";

import { useState } from "react";
import { GoogleIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

export function GoogleButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    // On success the browser is already navigating to Google.
    if (error) {
      setError("Couldn't reach Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="btn btn-lg w-full bg-white font-medium text-[#1f1f1f] hover:bg-white/90"
      >
        <GoogleIcon />
        {busy ? "Redirecting to Google…" : "Continue with Google"}
      </button>
      {error && (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
