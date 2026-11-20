import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    pool: "forks",
    // One throwaway database is shared by every file, so files run one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
