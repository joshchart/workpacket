import { describe, expect, test } from "bun:test";
import { parseArgs } from "../parse-args.js";

describe("parseArgs", () => {
  // Helper: simulate argv with bun and script prefix
  const argv = (...args: string[]) => ["bun", "src/cli/main.ts", ...args];

  describe("help", () => {
    test("no args → help", () => {
      const result = parseArgs(argv());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.args.command).toBe("help");
    });

    test("--help → help", () => {
      const result = parseArgs(argv("--help"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.args.command).toBe("help");
    });

    test("-h → help", () => {
      const result = parseArgs(argv("-h"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.args.command).toBe("help");
    });
  });

  describe("build command", () => {
    test("build with assignment dir", () => {
      const result = parseArgs(argv("build", "./hw3"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args.command).toBe("build");
        expect(result.args).toHaveProperty("assignmentDir", "./hw3");
        expect(result.args).toHaveProperty("draft", false);
      }
    });

    test("build with --draft flag", () => {
      const result = parseArgs(argv("build", "./hw3", "--draft"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args).toHaveProperty("draft", true);
      }
    });

    test("build with --output", () => {
      const result = parseArgs(argv("build", "./hw3", "--output", "./out"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args).toHaveProperty("outputDir", "./out");
      }
    });

    test("build with --output=value", () => {
      const result = parseArgs(argv("build", "./hw3", "--output=./out"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args).toHaveProperty("outputDir", "./out");
      }
    });

    test("build missing assignment dir → error", () => {
      const result = parseArgs(argv("build"));
      expect(result.ok).toBe(false);
    });

    test("build --help → help", () => {
      const result = parseArgs(argv("build", "--help"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.args.command).toBe("help");
    });

    test("build with --draft and --output combined", () => {
      const result = parseArgs(
        argv("build", "./hw3", "--draft", "--output", "./out"),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args).toHaveProperty("draft", true);
        expect(result.args).toHaveProperty("outputDir", "./out");
        expect(result.args).toHaveProperty("assignmentDir", "./hw3");
      }
    });
  });

  describe("ingest command", () => {
    test("ingest with assignment dir", () => {
      const result = parseArgs(argv("ingest", "./hw3"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args.command).toBe("ingest");
        expect(result.args).toHaveProperty("assignmentDir", "./hw3");
      }
    });

    test("ingest with --output", () => {
      const result = parseArgs(argv("ingest", "./hw3", "--output", "./out"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args).toHaveProperty("outputDir", "./out");
      }
    });

    test("ingest missing assignment dir → error", () => {
      const result = parseArgs(argv("ingest"));
      expect(result.ok).toBe(false);
    });
  });

  describe("packet command", () => {
    test("packet with assignment id", () => {
      const result = parseArgs(argv("packet", "hw3"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args.command).toBe("packet");
        expect(result.args).toHaveProperty("assignmentId", "hw3");
      }
    });

    test("packet with --output", () => {
      const result = parseArgs(argv("packet", "hw3", "--output", "./out"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args).toHaveProperty("outputDir", "./out");
      }
    });

    test("packet missing assignment id → error", () => {
      const result = parseArgs(argv("packet"));
      expect(result.ok).toBe(false);
    });
  });

  describe("unknown command", () => {
    test("unknown command → error", () => {
      const result = parseArgs(argv("badcommand"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error).toContain("Unknown command");
      }
    });

    test("unknown command includes usage hint", () => {
      const result = parseArgs(argv("badcommand"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.usage).toContain("--help");
      }
    });
  });
});
