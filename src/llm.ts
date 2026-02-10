import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
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

/**
 * Create an Anthropic client instance.
 * Reads ANTHROPIC_API_KEY from environment.
 * Throws immediately if the key is not set.
 */
function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. " +
      "Set it before running LLM-powered stages."
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Call the LLM with a system prompt and user message.
 * Returns the text response and token usage.
 *
 * The client is created on each call (stateless).
 * The Anthropic SDK handles HTTP errors and rate limiting internally.
 */
export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const client = createClient();
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
  });

  // Extract text from the response content blocks
  const textBlocks = response.content.filter((block) => block.type === "text");
  const text = textBlocks.map((block) => block.text).join("");

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
