// Environment loading for Folio's operator scripts.
//
// Order of precedence (highest first):
//   1. variables already in the environment (for example `node --env-file=.env.local`)
//   2. .env.local   — the local development file
//   3. .env         — shared defaults
//
// Nothing is ever overwritten, and no secret value is printed.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Loads .env.local then .env without overriding existing variables. */
export function loadFolioEnv(root = process.cwd()) {
  const sources = [resolve(root, ".env.local"), resolve(root, ".env")];
  const applied = [];
  for (const file of sources) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFile(file);
    let count = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
        count++;
      }
    }
    if (count) applied.push(`${file.split(/[\\/]/).pop()} (${count} value${count === 1 ? "" : "s"})`);
  }
  return applied;
}

/** A safe description of the target database. Never includes the password. */
export function describeTarget(url) {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, "") || "(default)";
    const host = parsed.hostname;
    const provider = /neon\.(tech|build)|neon\.build/i.test(host)
      ? "Neon"
      : /localhost|127\.0\.0\.1/.test(host)
        ? "local PostgreSQL"
        : "PostgreSQL";
    const ssl = parsed.searchParams.get("sslmode");
    return { provider, host, database, sslmode: ssl ?? "(driver default)", port: parsed.port || "5432" };
  } catch {
    return { provider: "unknown", host: "(unparseable DATABASE_URL)", database: "(unknown)", sslmode: "(unknown)", port: "(unknown)" };
  }
}

export function printTarget(url) {
  const target = describeTarget(url);
  console.log(`  Target   : ${target.provider} · ${target.host}:${target.port}/${target.database}`);
  console.log(`  SSL mode : ${target.sslmode}`);
}
