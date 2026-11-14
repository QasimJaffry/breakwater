import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const p = (s: string) => fileURLToPath(new URL(s, import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      "@breakwater/core": p("./packages/core/src/index.ts"),
      "@breakwater/cli": p("./packages/cli/src/index.ts"),
      "@breakwater/collector": p("./packages/collector/src/index.ts"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts"] },
});
