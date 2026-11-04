import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    // Fake LLM calls stream without delay in tests.
    env: { KOMASLATE_FAKE_STREAM_MS: "0" },
  },
});
