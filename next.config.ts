import type { NextConfig } from "next";

/**
 * Desktop export mode (`npm run build:desktop` → `scripts/build-desktop.mjs`
 * sets NEXT_PUBLIC_DESKTOP_BUILD=1 and prunes web-only routes):
 *
 *   - `output: "export"` emits a fully static `out/` directory, which
 *     `tauri.conf.json` wires as `frontendDist` (window `url: "index.html"`).
 *     The desktop shell is served from local assets, so it boots with zero
 *     network involvement — the root cause of the offline white-screen.
 *   - `images.unoptimized` — no Next image optimizer in a static bundle.
 *   - Security headers move to the deployed web server (Next.js does not
 *     support custom headers with `output: "export"`).
 */

const isDesktopBuild = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  devIndicators: false,
  ...(isDesktopBuild
    ? {
        output: "export" as const,
        images: { unoptimized: true },
      }
    : {
        outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
        async headers() {
          return [
            { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
            { source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
          ];
        },
      }),
};

export default nextConfig;
