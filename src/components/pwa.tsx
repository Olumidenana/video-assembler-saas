"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Registers the service worker (production only: in development it would cache stale code). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * "Install app": Chrome, Edge and Samsung Internet offer a real install
 * prompt; iPhone and iPad don't, so they get the two steps to add it to the
 * Home Screen instead. Hidden once the app is installed and running.
 */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
      setMode("prompt");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Safari on iPhone and iPad never fires beforeinstallprompt.
    const ios = isIos() ? window.setTimeout(() => setMode((m) => (m === "hidden" ? "ios" : m)), 0) : 0;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(ios);
    };
  }, []);

  if (mode === "hidden") return null;

  return (
    <span className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        data-testid="install-app"
        onClick={async () => {
          if (mode === "ios" || !prompt) {
            setHelp((h) => !h);
            return;
          }
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === "accepted") setMode("hidden");
          setPrompt(null);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M12 7v7m-3-3 3 3 3-3M10 18h4" />
        </svg>
        <span className="sm:hidden">App</span>
        <span className="hidden sm:inline">Get the app</span>
      </button>
      {help && (
        <span className="fixed inset-x-4 top-16 z-50 mt-2 rounded-xl border border-line bg-surface p-3 text-left text-xs text-muted shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-64" role="dialog" aria-label="Install on iPhone">
          <span className="mb-1 block font-medium text-fg">Install on iPhone or iPad</span>
          1. In Safari, tap the Share button <span aria-hidden>(□↑)</span>.
          <br />
          2. Tap <span className="text-fg">Add to Home Screen</span>, then Add.
          <br />
          It opens full screen like any app.
        </span>
      )}
    </span>
  );
}
