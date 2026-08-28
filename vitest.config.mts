import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only exists to stop server modules reaching the client bundle.
      // Tests run in plain Node, where that guard has nothing to protect.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Concurrency tests open real connections and race on purpose.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
