import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/editor", "/pricing", "/privacy", "/terms"].map((path) => ({
    url: `${publicEnv.siteUrl}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
