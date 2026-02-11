import { loadTokens, saveTokens, isExpired, type StoredTokens } from "./auth.js";

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_MODEL = "gpt-5.1-codex-mini";
const DEFAULT_MAX_TOKENS = 4096;

export interface LLMRequest {
  /** System prompt defining the task */
  readonly system: string;
  /** User message containing the context/input */
  readonly user: string;
  /** Max tokens for the response. Defaults to 4096. */
  readonly maxTokens?: number;
}

export interface LLMResponse {
  /** The text content of the LLM response */
  readonly text: string;
  /** Input tokens used */
  readonly inputTokens: number;
  /** Output tokens used */
  readonly outputTokens: number;
}

export function getModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}. Run 'workpacket login' to re-authenticate.`);
  }
  return response.json();
}

async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      "Not authenticated. Run 'workpacket login' to authenticate with your ChatGPT subscription."
    );
  }

  if (!isExpired(tokens)) {
    return tokens.access_token;
  }

  // Token expired — refresh it
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  const updated: StoredTokens = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
    account_id: tokens.account_id,
  };
  saveTokens(updated);
  return updated.access_token;
}

export function extractText(data: Record<string, unknown>): string {
  // The response.completed SSE event wraps the response object:
  // { type: "response.completed", response: { output: [...], usage: {...} } }
  const responseObj = (data.response as Record<string, unknown>) ?? data;
  const output = responseObj.output;
  if (!output || !Array.isArray(output)) {
    throw new Error("Unexpected Codex API response: missing 'output' array");
  }
  const texts: string[] = [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === "output_text" && typeof block.text === "string") {
          texts.push(block.text);
        }
      }
    }
  }
  if (texts.length === 0) {
    throw new Error("Codex API returned no text content in response");
  }
  return texts.join("");
}

/**
 * Call the LLM with a system prompt and user message.
 * Returns the text response and token usage.
 *
 * Uses OAuth tokens from ~/.workpacket/auth.json.
 * Automatically refreshes expired access tokens.
 */
/**
 * Parse SSE stream and return the final "response.completed" event data.
 * The Codex API sends events like:
 *   event: response.created
 *   data: {...}
 *
 *   event: response.output_text.delta
 *   data: {...}
 *
 *   event: response.completed
 *   data: {full response object with output[] and usage{}}
 */
async function readSSEResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let completedData: Record<string, unknown> | null = null;

  // Parse SSE format: lines of "event: xxx" and "data: {...}"
  const lines = text.split("\n");
  let currentEvent = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ") && currentEvent === "response.completed") {
      try {
        completedData = JSON.parse(line.slice(6));
      } catch {
        // ignore parse errors on non-final chunks
      }
    }
  }

  if (!completedData) {
    // Debug: log unique event types and a snippet of the raw response
    const events = new Set<string>();
    for (const line of lines) {
      if (line.startsWith("event: ")) events.add(line.slice(7).trim());
    }
    const snippet = text.slice(0, 2000);
    throw new Error(
      `Codex API stream ended without a response.completed event.\n` +
      `Events seen: [${[...events].join(", ")}]\n` +
      `Response snippet:\n${snippet}`
    );
  }

  return completedData;
}

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const accessToken = await getValidAccessToken();
  const model = getModel();

  const response = await fetch(CODEX_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      model,
      instructions: request.system,
      input: [{ role: "user", content: request.user }],
      store: false,
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Codex API request failed (${response.status}): ${body}`
    );
  }

  const data = await readSSEResponse(response);
  const text = extractText(data);
  // Usage is inside the nested response object for SSE response.completed events
  const responseObj = (data.response as Record<string, unknown>) ?? data;
  const usage = responseObj.usage as {
    input_tokens?: number;
    output_tokens?: number;
    // Legacy field names (kept for compatibility)
    prompt_tokens?: number;
    completion_tokens?: number;
  } | undefined;

  return {
    text,
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
  };
}
