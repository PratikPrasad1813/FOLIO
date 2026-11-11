export async function resolve(specifier, context, next) {
  if (specifier === "@tauri-apps/plugin-sql") {
    // Tests run outside the Tauri shell: map the plugin onto node:sqlite.
    return { url: new URL("./mock-plugin-sql.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const base = new URL("../../src/", import.meta.url);
    // Append .ts only for extensionless specifiers (JSON imports keep theirs).
    const target = /\.[a-z]+$/.test(specifier) ? specifier.slice(2) : `${specifier.slice(2)}.ts`;
    return next(new URL(`./${target}`, base).href, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  // Node ESM requires an explicit import attribute for JSON modules; the
  // app's bundler (Turbopack) does not, so add it transparently here.
  if (url.endsWith(".json")) {
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: "json" } });
  }
  return next(url, context);
}
