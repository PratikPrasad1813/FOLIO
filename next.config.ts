import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  devIndicators: false,
  // Avoid stale Turbopack dev-cache HMR reload loops when isolated servers use different public origins.
  experimental: { turbopackFileSystemCacheForDev: false, turbopackServerFastRefresh: false },
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
  async headers() {
    return [
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
      { source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    ];
  },
};

export default nextConfig;
