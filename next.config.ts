import type { NextConfig } from "next";

/**
 * Cross-origin isolation (COOP + COEP) unlocks SharedArrayBuffer, which the
 * multi-threaded FFmpeg.wasm core needs. It also blocks third-party scripts and
 * iframes that don't opt in, so the Paystack inline checkout would break.
 *
 * We therefore isolate ONLY the editor. Checkout lives on /pricing, which
 * keeps default headers. Navigation between the two must be a full page load
 * (see src/components/hard-link.tsx) because the browser applies these
 * headers per document, not per client-side route change.
 */
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

/** Baseline hardening for every page. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/editor", headers: isolationHeaders },
      { source: "/editor/:path*", headers: isolationHeaders },
      {
        // Self-hosted FFmpeg core (copied by scripts/copy-ffmpeg-core.mjs).
        // Workers spawned from these files need COEP themselves to stay isolated.
        source: "/ffmpeg/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
