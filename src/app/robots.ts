import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return { rules: { userAgent: "*", allow: ["/", "/privacy", "/terms"], disallow: ["/api/", "/login", "/signup", "/onboarding", "/preferences", "/overview", "/projects", "/tasks", "/ideas", "/calendar", "/ai", "/settings"] }, sitemap: `${base}/sitemap.xml` };
}
