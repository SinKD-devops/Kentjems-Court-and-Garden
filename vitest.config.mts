import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Concurrency tests open real connections and race on purpose.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
