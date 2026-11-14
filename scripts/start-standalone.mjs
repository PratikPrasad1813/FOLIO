#!/usr/bin/env node
/**
 * scripts/start-standalone.mjs — production start command (`npm run start`).
 *
 * WHY THIS EXISTS: next.config.ts builds the web app with
 * `output: "standalone"`, and Next.js refuses to run that build through
 * `next start`:
 *
 *   "next start" does not work with "output: standalone" configuration.
 *   Use "node .next/standalone/server.js" instead.
 *
 * The standalone output is a self-contained server (`server.js` plus the
 * traced subset of node_modules). Per the Next.js docs it intentionally does
 * NOT copy `public/` or `.next/static/` (they are normally served by a CDN),
 * so without them the page HTML loads but every CSS/JS/image request 404s.
 * This launcher therefore:
 *
 *   1. verifies `npm run build` produced the standalone server,
 *   2. copies `public/` and `.next/static/` next to it (idempotent),
 *   3. starts `node .next/standalone/server.js`, honouring the PORT that
 *      Render (or any PaaS) injects and binding to 0.0.0.0,
 *   4. forwards SIGTERM/SIGINT so Render's rolling deploys shut down cleanly.
 *
 * It is deliberately NOT a `postbuild` hook: `npm run build:desktop` also runs
 * `npm run build`, and the desktop export (`output: "export"`) has no
 * standalone folder.
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = join(root, ".next", "standalone");
const serverJs = join(standaloneDir, "server.js");

if (!existsSync(serverJs)) {
  console.error(
    "[start] .next/standalone/server.js was not found.\n" +
    "        Run `npm run build` first (a desktop/static-export build does not produce it).",
  );
  process.exit(1);
}

/** Copies a build/asset folder into the standalone tree when it exists. */
function syncAssets(from, to) {
  if (!existsSync(from)) return;
  cpSync(from, to, { recursive: true, force: true });
}

syncAssets(join(root, "public"), join(standaloneDir, "public"));
syncAssets(join(root, ".next", "static"), join(standaloneDir, ".next", "static"));

const env = {
  ...process.env,
  PORT: process.env.PORT || "3000",
  // Containers (Render, Docker) pre-set HOSTNAME to the container id, which the
  // standalone server would bind to instead of every interface. Bind explicitly
  // to 0.0.0.0 (what the old `next start -H 0.0.0.0` did); override with HOST.
  HOSTNAME: process.env.HOST || "0.0.0.0",
  NODE_ENV: "production",
};

const child = spawn(process.execPath, [serverJs], { cwd: standaloneDir, env, stdio: "inherit" });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error("[start] Could not launch the standalone server:", error);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
