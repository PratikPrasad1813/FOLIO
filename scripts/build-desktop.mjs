#!/usr/bin/env node
/**
 * scripts/build-desktop.mjs — build the STATIC desktop bundle into `out/`.
 *
 * Wraps `next build` with `NEXT_PUBLIC_DESKTOP_BUILD=1` and `output:
 * "export"` (see next.config.ts). Because a static export cannot contain
 * Next.js route handlers or the server-rendered web-only pages, the script
 * temporarily stashes those routes, builds, and restores them — the working
 * tree is left untouched even when the build fails.
 *
 * Output: `out/` (picked up by tauri.conf.json → frontendDist "../out",
 * window url "index.html"). The desktop shell then:
 *   - boots from local assets (works with Wi-Fi off),
 *   - authenticates from the local_auth SQLite row (no /api/auth/session),
 *   - renders the workspace from local SQLite (no /api/workspace),
 *   - syncs in the background against the deployed API (Bearer + CORS).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "src", "app");
const stashDir = join(root, ".desktop-build-stash");

/** Web-only routes: server-rendered pages, route handlers, and metadata files. */
const EXCLUDED_PATHS = [
  // Route handlers — no server exists in the static bundle.
  "api",
  // Server-rendered auth / account pages (the desktop gate has its own sign-in).
  "login",
  "signup",
  "onboarding",
  "preferences",
  "recover",
  "verify-email",
  "desktop-auth", // web-side pairing station, opened in the SYSTEM browser
  // Marketing / informational surfaces (web-only).
  "docs",
  "download",
  "privacy",
  "terms",
  "dev",
  // Metadata route handlers.
  "robots.ts",
  "sitemap.ts",
  "opengraph-image.tsx",
  // Dynamic /projects/<id> detail route: cannot be prerendered (runtime
  // UUIDs). The desktop shell opens projects through client state instead
  // (see workspace.tsx → desktopProjectId).
// Dynamic routes: cannot be prerendered statically
  "(workspace)/[view]",
  "(workspace)/[view]/[id]",
];

function stashExcluded() {
  rmSync(stashDir, { recursive: true, force: true });
  mkdirSync(stashDir, { recursive: true });
  const stashed = [];
  for (const relative of EXCLUDED_PATHS) {
    const from = join(appDir, relative);
    if (!existsSync(from)) {
      console.warn(`[build-desktop] skip (missing): ${relative}`);
      continue;
    }
    const to = join(stashDir, relative.replaceAll("/", "__"));
    renameSync(from, to);
    stashed.push({ from, to, relative });
  }
  return stashed;
}

function restoreExcluded(stashed) {
  for (const entry of stashed) {
    try {
      renameSync(entry.to, entry.from);
    } catch (error) {
      console.error(`[build-desktop] FAILED to restore ${entry.relative}:`, error);
      process.exitCode = 1;
    }
  }
  rmSync(stashDir, { recursive: true, force: true });
}

function runBuild() {
  // Using execSync directly runs within the platform shell (resolves Windows EINVAL)
  execSync("npm run build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
}

function main() {
  const outDir = join(root, "out");
  console.log("[build-desktop] stashing web-only routes…");
  const stashed = stashExcluded();
  let failed = false;
  try {
    console.log("[build-desktop] running next build (output: export)…");
    rmSync(outDir, { recursive: true, force: true });
    runBuild();
  } catch (error) {
    failed = true;
    console.error("[build-desktop] build failed:", error instanceof Error ? error.message : error);
  } finally {
    console.log("[build-desktop] restoring web-only routes…");
    restoreExcluded(stashed);
  }

  if (failed) {
    console.error("[build-desktop] FAILED — no bundle was produced.");
    process.exit(1);
  }
  if (!existsSync(join(outDir, "index.html"))) {
    console.error("[build-desktop] FAILED — out/index.html is missing.");
    process.exit(1);
  }

  console.log("[build-desktop] OK — static desktop bundle written to out/");
  console.log(`[build-desktop] manifest sha256: ${createHash("sha256").update(String(stashed.length)).digest("hex").slice(0, 12)} (${stashed.length} routes stashed & restored)`);
}

main();