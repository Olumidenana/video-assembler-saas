"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong.</h1>
      <p className="max-w-md text-muted">
        Sorry about that. Your videos are safe on your device; nothing was uploaded. Try again, or reload the page.
      </p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
