import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/index.js",
  // esbuild preserves the entry file's own `#!/usr/bin/env node` shebang on
  // line 1, so we must NOT add one here (that produced a double shebang that
  // crashed Node). The banner only provides the CJS interop shims that bundled
  // CommonJS dependencies (commander, etc.) need under ESM output.
  banner: {
    js: [
      "import { createRequire as _createRequire } from 'module';",
      "import { fileURLToPath as _fileURLToPath } from 'url';",
      "const require = _createRequire(import.meta.url);",
      "const __filename = _fileURLToPath(import.meta.url);",
      "const __dirname = _fileURLToPath(new URL('.', import.meta.url));",
    ].join("\n"),
  },
  external: ["puppeteer-core"],
});
