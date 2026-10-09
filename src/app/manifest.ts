import type { MetadataRoute } from "next";

/**
 * Makes the site an installable app: home-screen icon, opens full screen
 * without the browser bar, appears in the phone's share menu for videos
 * (Android), and offers shortcuts on a long press of the icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AuraCut · AI video editor",
    short_name: "AuraCut",
    description: "Turn long videos into viral shorts: AI picks the best moments, captions, music and beat-synced edits, right on your phone.",
    start_url: "/editor",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0a0a0d",
    theme_color: "#0a0a0d",
    categories: ["photo", "video", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // "Share -> Anti-Timeout" from the gallery, TikTok, WhatsApp... (handled by public/sw.js).
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: "videos", accept: ["video/*", ".mp4", ".mov", ".webm", ".mkv"] }] },
    },
    shortcuts: [
      { name: "Clip Pack", short_name: "Clip Pack", description: "Turn a video into finished posts", url: "/editor#tool-pack", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Edits & mashups", short_name: "Edits", description: "Beat-synced edits, quote edits, countdowns", url: "/editor#tool-mashup", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  } as MetadataRoute.Manifest;
}
