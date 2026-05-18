import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "shared/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      "config/**/*.test.ts",
    ],
    // Default to node for server tests
    environment: "node",
    // Use jsdom for React component tests
    environmentMatchGlobs: [
      ["client/**/*.test.tsx", "jsdom"],
      ["client/**/*.test.ts", "jsdom"],
    ],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Use basic reporter to avoid EPIPE errors on Windows when stdout closes early
    reporters: ["basic"],
    // Disable watch mode output that can cause EPIPE
    watch: false,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
