import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pricing · Anti-Timeout" };

// Not cross-origin isolated on purpose: the Paystack inline popup loads here (Stage 3).
export default function PricingPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Pricing</h1>
      <p className="text-foreground/70">
        Free: up to 3 clips per stitch, 720p export. Pro (monthly, NGN): unlimited clips and
        full-resolution export.
      </p>
      {/* Stage 3: Paystack subscription checkout. */}
    </section>
  );
}
