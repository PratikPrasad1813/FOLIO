// Loads existing TypeScript services for isolated test/capture fixtures only.
// No production route exposes this loader or creates demonstration data.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(process.cwd(), 'src', request.slice(2));
  return original.call(this, request, parent, ...rest);
};
// The loader is used only by isolated operator scripts; Next request headers do
// not exist there. Application requests still use the real Next implementation.
const stubs = new Map([
  ["next/headers", { cookies: async () => ({ get: () => undefined }), headers: async () => new Map() }],
]);
const cacheKey = (name) => path.join(process.cwd(), "node_modules", ".folio-test-stub", name.replaceAll("/", "_"));
Module._load = new Proxy(Module._load, {
  apply(target, thisArg, args) {
    const request = args[0];
    for (const [name, stub] of stubs) {
      if (request === name || request === path.join(process.cwd(), "src", name.slice(2)) ||
          (name.startsWith("@/") && request.endsWith(name.slice(2).replaceAll("\\", "/")))) {
        const key = cacheKey(name);
        const cached = require.cache[key];
        if (cached) return cached.exports;
        require.cache[key] = { id: key, filename: key, loaded: true, exports: stub, path: path.dirname(key), children: [], paths: [] };
        return stub;
      }
    }
    return Reflect.apply(target, thisArg, args);
  },
});
require.extensions['.ts'] = (module, filename) => {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true } }).outputText;
  module._compile(compiled, filename);
};
module.exports = require;
