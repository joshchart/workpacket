import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { callLLM, extractText, getModel } from "../llm.js";
import { loadTokens } from "../auth.js";

describe("callLLM", () => {
  const hasTokens = loadTokens() !== null;

  // Only run when no auth.json exists (CI). When logged in locally,
  // this would make a real API call, so skip it.
  (hasTokens ? test.skip : test)(
    "throws when not authenticated (no auth.json)",
    async () => {
      await expect(
        callLLM({ system: "test", user: "test" })
      ).rejects.toThrow("Not authenticated");
    },
  );
});

describe("getModel", () => {
  const originalModel = process.env.OPENAI_MODEL;

  afterEach(() => {
    if (originalModel !== undefined) {
      process.env.OPENAI_MODEL = originalModel;
    } else {
      delete process.env.OPENAI_MODEL;
    }
  });

  test("reads model from OPENAI_MODEL env var", () => {
    process.env.OPENAI_MODEL = "gpt-5.2-codex";
    expect(getModel()).toBe("gpt-5.2-codex");
  });

  test("falls back to default model when OPENAI_MODEL not set", () => {
    delete process.env.OPENAI_MODEL;
    expect(getModel()).toBe("gpt-5.1-codex-mini");
  });
});

describe("extractText", () => {
  test("extracts text from valid Responses API output", () => {
    const data = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hello, world!" },
          ],
        },
      ],
    };
    expect(extractText(data)).toBe("Hello, world!");
  });

  test("concatenates multiple text blocks", () => {
    const data = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hello, " },
            { type: "output_text", text: "world!" },
          ],
        },
      ],
    };
    expect(extractText(data)).toBe("Hello, world!");
  });

  test("concatenates text across multiple output items", () => {
    const data = {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Part 1. " }],
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "Part 2." }],
        },
      ],
    };
    expect(extractText(data)).toBe("Part 1. Part 2.");
  });

  test("ignores non-message output items", () => {
    const data = {
      output: [
        { type: "other_thing", content: "ignored" },
        {
          type: "message",
          content: [{ type: "output_text", text: "Real text" }],
        },
      ],
    };
    expect(extractText(data)).toBe("Real text");
  });

  test("throws on missing output array", () => {
    expect(() => extractText({})).toThrow("missing 'output' array");
  });

  test("throws on non-array output", () => {
    expect(() => extractText({ output: "not an array" })).toThrow("missing 'output' array");
  });

  test("throws when no text content found", () => {
    const data = {
      output: [
        { type: "other", content: [] },
      ],
    };
    expect(() => extractText(data)).toThrow("no text content");
  });

  test("throws when output array is empty", () => {
    expect(() => extractText({ output: [] })).toThrow("no text content");
  });

  test("extracts text from SSE response.completed wrapper", () => {
    const data = {
      type: "response.completed",
      response: {
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Wrapped response" }],
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    };
    expect(extractText(data)).toBe("Wrapped response");
  });
});

describe("callLLM integration", () => {
  // Integration test — only runs when explicitly opted in
  const runLive = process.env.RUN_LIVE_LLM_TESTS === "1";
  (runLive ? test : test.skip)(
    "returns text response from Codex API (integration)",
    async () => {
      const response = await callLLM({
        system: "Respond with exactly: hello",
        user: "Say hello.",
        maxTokens: 32,
      });
      expect(response.text).toBeTruthy();
      expect(response.inputTokens).toBeGreaterThanOrEqual(0);
      expect(response.outputTokens).toBeGreaterThan(0);
    },
    30_000, // API streaming can take 10s+
  );
});
