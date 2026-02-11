import { describe, test, expect } from "bun:test";
import { isExpired, type StoredTokens } from "../auth.js";

describe("isExpired", () => {
  test("returns true for expired tokens", () => {
    const expired: StoredTokens = {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() - 1000, // 1 second ago
    };
    expect(isExpired(expired)).toBe(true);
  });

  test("returns true for tokens expiring within 5-minute buffer", () => {
    const almostExpired: StoredTokens = {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() + 2 * 60 * 1000, // 2 minutes from now
    };
    expect(isExpired(almostExpired)).toBe(true);
  });

  test("returns false for fresh tokens", () => {
    const fresh: StoredTokens = {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() + 60 * 60 * 1000, // 1 hour from now
    };
    expect(isExpired(fresh)).toBe(false);
  });

  test("returns false for tokens expiring in exactly 5 minutes", () => {
    // At exactly the 5-minute boundary, Date.now() === expires_at - 5*60*1000
    // so the comparison is > (not >=), meaning it's NOT expired
    const boundary: StoredTokens = {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() + 5 * 60 * 1000,
    };
    expect(isExpired(boundary)).toBe(false);
  });
});

describe("loadTokens", () => {
  test("returns null or valid tokens (does not throw)", async () => {
    const { loadTokens } = await import("../auth.js");
    const result = loadTokens();
    expect(result === null || typeof result === "object").toBe(true);
  });
});
