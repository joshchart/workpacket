import { describe, test, expect } from "bun:test";
import { callLLM } from "../llm.js";

describe("callLLM", () => {
  test("throws when ANTHROPIC_API_KEY is not set", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(
        callLLM({ system: "test", user: "test" })
      ).rejects.toThrow("ANTHROPIC_API_KEY");
    } finally {
      if (original) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  // Integration test — only runs when explicitly opted in via env flag.
  // Gated on RUN_LIVE_LLM_TESTS (not just ANTHROPIC_API_KEY) so that
  // `bun test` stays fast, deterministic, and free by default.
  const runLive = process.env.RUN_LIVE_LLM_TESTS === "1";
  (runLive ? test : test.skip)(
    "returns text response from Claude (integration)",
    async () => {
      const response = await callLLM({
        system: "Respond with exactly: hello",
        user: "Say hello.",
        maxTokens: 32,
      });
      expect(response.text).toBeTruthy();
      expect(response.inputTokens).toBeGreaterThan(0);
      expect(response.outputTokens).toBeGreaterThan(0);
    },
  );
});
