import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return ["", "/privacy", "/terms"].map(path => ({ url: `${base}${path}`, changeFrequency: "monthly", priority: path ? 0.4 : 1 }));
}
