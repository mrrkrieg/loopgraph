import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "loopgraph/core": path.resolve(__dirname, "src/core/index.ts"),
      "loopgraph/runtime": path.resolve(__dirname, "src/runtime/index.ts"),
      "loopgraph/sdk": path.resolve(__dirname, "src/sdk/index.ts")
    }
  }
});
