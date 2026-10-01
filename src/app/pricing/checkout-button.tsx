"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon } from "@/components/icons";

type State = { status: "idle" } | { status: "busy"; label: string } | { status: "error"; message: string };

async function verify(reference: string): Promise<string | null> {
  const res = await fetch("/api/paystack/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference }),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "We couldn't confirm your payment.";
}

/**
 * Opens Paystack's inline checkout for the Pro plan. `returnReference` is set
 * when Paystack redirected back here instead of using the popup (some mobile
 * browsers), in which case we verify straight away.
 */
export function CheckoutButton({
  label,
  tier,
  returnReference,
  variant = "primary",
}: {
  label: string;
  tier: "pro" | "studio";
  returnReference?: string;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<State>(
    returnReference ? { status: "busy", label: "Confirming payment…" } : { status: "idle" },
  );
  const verifiedReturn = useRef(false);

  async function finish(reference: string) {
    setState({ status: "busy", label: "Confirming payment…" });
    const error = await verify(reference);
    if (error) setState({ status: "error", message: error });
    // Full page load on purpose: the editor needs its own cross-origin isolated
    // document, which a client-side router.push() would not create.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    else window.location.assign(`/editor?welcome=${tier}`);
  }

  useEffect(() => {
    if (!returnReference || verifiedReturn.current) return;
    verifiedReturn.current = true;
    void (async () => {
      const error = await verify(returnReference);
      if (error) setState({ status: "error", message: error });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load for the isolated editor
      else window.location.assign(`/editor?welcome=${tier}`);
    })();
  }, [returnReference, tier]);

  async function start() {
    setState({ status: "busy", label: "Opening secure checkout…" });
    const res = await fetch("/api/paystack/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    const body = (await res.json().catch(() => ({}))) as { accessCode?: string; error?: string };
    if (!res.ok || !body.accessCode) {
      setState({ status: "error", message: body.error ?? "Couldn't start checkout." });
      return;
    }

    const { default: PaystackPop } = await import("@paystack/inline-js");
    new PaystackPop().resumeTransaction(body.accessCode, {
      onSuccess: ({ reference }) => void finish(reference),
      onCancel: () => setState({ status: "idle" }),
      onError: ({ message }) => setState({ status: "error", message }),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" className={`btn btn-${variant} btn-lg w-full`} onClick={start} disabled={state.status === "busy"}>
        {state.status === "busy" ? state.label : label}
        {state.status !== "busy" && <ArrowRightIcon />}
      </button>
      {state.status === "error" && (
        <p className="notice notice-danger" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
