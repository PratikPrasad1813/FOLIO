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
 * TWO FAILURE MODES THIS SCRIPT IS HARDENED AGAINST (post-mortem #3 & #5):
 *
 *   1. "Page with dynamic = 'force-dynamic' couldn't be exported." A route
 *      that survives the stash list but still opts into dynamic rendering
 *      (or `export const revalidate`) crashes the static export. Before the
 *      build runs, a sweep stashes ANY remaining page/layout/route that
 *      declares `dynamic`, `revalidate`, or `fetchCache` — so a future
 *      regression on a web route can never break `build:desktop`.
 *
 *   2. Windows `spawnSync EINVAL`. npm is invoked through `execSync` with
 *      `shell: true`, which routes the command through cmd.exe/POSIX sh and
 *      never trips over the .cmd shim spawning restrictions.
 *
 * Output: `out/` (picked up by tauri.conf.json → frontendDist "../out",
 * window url "index.html"). The desktop shell then:
 *   - boots from local assets (works with Wi-Fi off),
 *   - authenticates from the local_auth SQLite row (no /api/auth/session),
 *   - renders the workspace from local SQLite (no /api/workspace),
 *   - syncs in the background against the deployed API (Bearer + CORS).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
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
  "(workspace)/[view]/[id]",
];

/**
 * Static-export-incompatible segment directives. Any route file that
 * declares one of these AFTER the sweep must be stashed (or its route
 * pruned) — the export step cannot honour it.
 */
const DYNAMIC_EXPORT_PATTERN = /export\s+const\s+(dynamic|revalidate|fetchCache|dynamicParams)\s*=/;

/** Files that participate in Next.js route configuration. */
const ROUTE_FILE_PATTERN = /^(page|layout|route|template|default|error|loading|not-found)\.(tsx|ts|jsx|js)$/;

function walkRouteFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) found.push(...walkRouteFiles(full));
    else if (ROUTE_FILE_PATTERN.test(entry)) found.push(full);
  }
  return found;
}

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

/**
 * Safety sweep (post-mortem #3): stash any route file that survived the
 * explicit list but still declares a runtime-only segment config. Returns
 * the additional stashed entries so `restoreExcluded` can put everything
 * back even when the process fails mid-build.
 */
function stashDynamicRoutes(alreadyStashed) {
  const stashedPaths = new Set(alreadyStashed.map((entry) => entry.from));
  const extra = [];
  let candidates;
  try {
    candidates = walkRouteFiles(appDir);
  } catch (error) {
    console.warn("[build-desktop] dynamic-route sweep skipped:", error instanceof Error ? error.message : error);
    return extra;
  }
  for (const file of candidates) {
    if (stashedPaths.has(file)) continue;
    let source = "";
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!DYNAMIC_EXPORT_PATTERN.test(source)) continue;
    const relative = file.slice(appDir.length + 1);
    const to = join(stashDir, "__dynamic__", relative.replaceAll("/", "__"));
    mkdirSync(dirname(to), { recursive: true });
    renameSync(file, to);
    extra.push({ from: file, to, relative });
    console.warn(`[build-desktop] stashed dynamic route: ${relative}`);
  }
  return extra;
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
  // `shell: true` keeps this Windows-safe (no spawnSync EINVAL on the npm
  // .cmd shim) and POSIX-safe alike; the env vars drive next.config.ts.
  execSync("npm run build", {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, NEXT_PUBLIC_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
}

function main() {
  const outDir = join(root, "out");
  console.log("[build-desktop] stashing web-only routes…");
  const stashed = stashExcluded();
  console.log(`[build-desktop] sweeping for dynamic-only routes…`);
  const dynamicStashed = stashDynamicRoutes(stashed);
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
    restoreExcluded([...stashed, ...dynamicStashed]);
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
  const total = stashed.length + dynamicStashed.length;
  console.log(`[build-desktop] manifest sha256: ${createHash("sha256").update(String(total)).digest("hex").slice(0, 12)} (${stashed.length} web routes + ${dynamicStashed.length} dynamic routes stashed & restored)`);
}

main();
