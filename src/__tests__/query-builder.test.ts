import { describe, test, expect } from "bun:test";
import { buildDynamicQuery } from "../query-builder.js";

describe("buildDynamicQuery", () => {
  test("extracts significant terms from single text", () => {
    const result = buildDynamicQuery(["implement binary search tree"]);
    expect(result).toBe("implement OR binary OR search OR tree");
  });

  test("extracts terms from multiple texts and deduplicates", () => {
    const result = buildDynamicQuery([
      "binary search tree",
      "binary tree insertion",
    ]);
    expect(result).toBe("binary OR search OR tree OR insertion");
  });

  test("removes stop words", () => {
    const result = buildDynamicQuery(["the quick and lazy fox is very fast"]);
    expect(result).not.toContain("the");
    expect(result).not.toContain("and");
    expect(result).not.toContain("is");
    expect(result).not.toContain("very");
    expect(result).toContain("quick");
    expect(result).toContain("lazy");
    expect(result).toContain("fox");
    expect(result).toContain("fast");
  });

  test("removes short tokens (< 3 chars)", () => {
    const result = buildDynamicQuery(["a to do or go implement it"]);
    expect(result).toBe("implement");
  });

  test("returns empty string for empty input", () => {
    expect(buildDynamicQuery([])).toBe("");
  });

  test("returns empty string for input with only stop words", () => {
    expect(buildDynamicQuery(["the and or but is was are"])).toBe("");
  });

  test("respects MAX_TERMS limit (caps at 40 terms)", () => {
    // Generate 50 unique significant terms
    const words = Array.from({ length: 50 }, (_, i) => `term${i}xyz`);
    const result = buildDynamicQuery([words.join(" ")]);
    const terms = result.split(" OR ");
    expect(terms.length).toBe(40);
  });

  test("handles mixed case (lowercases all terms)", () => {
    const result = buildDynamicQuery(["Implement BINARY Search Tree"]);
    expect(result).toBe("implement OR binary OR search OR tree");
  });

  test("handles non-alphanumeric characters (splits correctly)", () => {
    const result = buildDynamicQuery(["bst_insert(tree, key) -> bool"]);
    expect(result).toContain("bst");
    expect(result).toContain("insert");
    expect(result).toContain("tree");
    expect(result).toContain("key");
    expect(result).toContain("bool");
  });

  test("joins terms with OR", () => {
    const result = buildDynamicQuery(["algorithm data structure"]);
    expect(result).toBe("algorithm OR data OR structure");
  });
});
