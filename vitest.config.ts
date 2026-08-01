import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": path.resolve(process.cwd(), "test/server-only.ts")
    }
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "packages/loopgraph/src/**/*.test.ts"]
  }
});
