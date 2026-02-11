import { describe, test, expect } from "bun:test";
import {
  generatePKCE,
  generateRandomString,
  base64UrlEncode,
  generateState,
  parseJwtClaims,
} from "../crypto-utils.js";

describe("generateRandomString", () => {
  test("produces string of requested length", () => {
    const result = generateRandomString(43);
    expect(result.length).toBe(43);
  });

  test("only contains unreserved characters", () => {
    const result = generateRandomString(100);
    expect(result).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  test("produces different strings on successive calls", () => {
    const a = generateRandomString(32);
    const b = generateRandomString(32);
    expect(a).not.toBe(b);
  });
});

describe("base64UrlEncode", () => {
  test("encodes empty buffer", () => {
    const result = base64UrlEncode(new Uint8Array([]).buffer);
    expect(result).toBe("");
  });

  test("produces URL-safe output (no +, /, or =)", () => {
    // Use bytes that would produce +, /, = in standard base64
    const bytes = new Uint8Array([251, 255, 254, 63, 62]);
    const result = base64UrlEncode(bytes.buffer);
    expect(result).not.toMatch(/[+/=]/);
  });

  test("encodes known value correctly", () => {
    // "Hello" in base64 is "SGVsbG8=", in base64url is "SGVsbG8"
    const encoder = new TextEncoder();
    const result = base64UrlEncode(encoder.encode("Hello").buffer);
    expect(result).toBe("SGVsbG8");
  });
});

describe("generatePKCE", () => {
  test("produces verifier and challenge", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier.length).toBe(43);
    expect(challenge.length).toBeGreaterThan(0);
  });

  test("challenge is base64url-encoded SHA-256 of verifier", async () => {
    const { verifier, challenge } = await generatePKCE();

    // Independently compute expected challenge
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
    const expected = base64UrlEncode(hash);

    expect(challenge).toBe(expected);
  });

  test("challenge contains no URL-unsafe characters", async () => {
    const { challenge } = await generatePKCE();
    expect(challenge).not.toMatch(/[+/=]/);
  });
});

describe("generateState", () => {
  test("produces non-empty string", () => {
    const state = generateState();
    expect(state.length).toBeGreaterThan(0);
  });

  test("produces different values on successive calls", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});

describe("parseJwtClaims", () => {
  test("parses valid JWT payload", () => {
    // Create a minimal JWT: header.payload.signature
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user123", email: "test@example.com" })).toString("base64url");
    const token = `${header}.${payload}.fake-signature`;

    const claims = parseJwtClaims(token);
    expect(claims).toEqual({ sub: "user123", email: "test@example.com" });
  });

  test("returns undefined for non-JWT string", () => {
    expect(parseJwtClaims("not-a-jwt")).toBeUndefined();
  });

  test("returns undefined for malformed payload", () => {
    expect(parseJwtClaims("a.!!!.c")).toBeUndefined();
  });
});
