import type { MetadataRoute } from "next";

/** Makes the site installable ("Add to Home Screen") so it opens like an app on phones. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anti-Timeout · AI video editor",
    short_name: "Anti-Timeout",
    description: "Find the best moments, remove silences, split and stitch videos, right on your phone.",
    start_url: "/editor",
    display: "standalone",
    background_color: "#0a0a0d",
    theme_color: "#0a0a0d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
