import { describe, expect, test } from "bun:test";
import {
  MAIN_USAGE,
  BUILD_USAGE,
  INGEST_USAGE,
  PACKET_USAGE,
} from "../help.js";

describe("help text", () => {
  test("main usage mentions all commands", () => {
    expect(MAIN_USAGE).toContain("build");
    expect(MAIN_USAGE).toContain("ingest");
    expect(MAIN_USAGE).toContain("packet");
    expect(MAIN_USAGE).toContain("login");
  });

  test("build usage mentions --draft", () => {
    expect(BUILD_USAGE).toContain("--draft");
  });

  test("all usages mention --help", () => {
    expect(MAIN_USAGE).toContain("--help");
    expect(BUILD_USAGE).toContain("--help");
    expect(INGEST_USAGE).toContain("--help");
    expect(PACKET_USAGE).toContain("--help");
  });
});
