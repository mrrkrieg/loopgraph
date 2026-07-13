import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as ("esm")[],
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: true
};

export default defineConfig([
  {
    ...shared,
    entry: {
      "core/index": "src/core/index.ts",
      "runtime/index": "src/runtime/index.ts",
      "sdk/index": "src/sdk/index.ts"
    },
    clean: true
  },
  {
    ...shared,
    entry: { cli: "src/cli/index.ts" },
    clean: false,
    banner: { js: "#!/usr/bin/env node" }
  }
]);
