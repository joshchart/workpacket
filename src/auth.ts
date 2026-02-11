import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_DIR = join(homedir(), ".workpacket");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix ms
  account_id?: string;
}

export function getAuthFile(): string {
  return AUTH_FILE;
}

export function loadTokens(): StoredTokens | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
    if (!data.access_token || !data.refresh_token || !data.expires_at) return null;
    return data as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
  writeFileSync(AUTH_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function isExpired(tokens: StoredTokens): boolean {
  // Refresh 5 minutes before actual expiry to avoid edge cases
  return Date.now() > tokens.expires_at - 5 * 60 * 1000;
}
