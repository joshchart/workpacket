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

  describe("login command", () => {
    test("login → login args", () => {
      const result = parseArgs(argv("login"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.args.command).toBe("login");
      }
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
