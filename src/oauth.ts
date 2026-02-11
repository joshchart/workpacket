import { saveTokens, type StoredTokens } from "./auth.js";
import { generatePKCE, generateState, parseJwtClaims } from "./crypto-utils.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const OAUTH_PORT = 1455;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in?: number;
}

export async function login(): Promise<void> {
  const pkce = await generatePKCE();
  const state = generateState();
  const redirectUri = `http://localhost:${OAUTH_PORT}/auth/callback`;

  // Start local callback server
  const { promise, server } = startCallbackServer(pkce, state, redirectUri);

  // Build authorization URL and open browser
  const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([opener, authUrl]);

  try {
    // Wait for OAuth callback (5 minute timeout)
    const tokens = await promise;

    // Extract account ID from JWT claims
    const accountId = extractAccountId(tokens);

    // Save tokens to disk
    const stored: StoredTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      account_id: accountId,
    };
    saveTokens(stored);
  } finally {
    server.stop();
  }
}

function buildAuthorizeUrl(
  redirectUri: string,
  pkce: { challenge: string },
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

function startCallbackServer(
  pkce: { verifier: string },
  state: string,
  redirectUri: string,
): { promise: Promise<TokenResponse>; server: ReturnType<typeof Bun.serve> } {
  let resolveCallback: (tokens: TokenResponse) => void;
  let rejectCallback: (error: Error) => void;

  const promise = new Promise<TokenResponse>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;

    // 5 minute timeout
    setTimeout(
      () => reject(new Error("OAuth timeout — no callback received within 5 minutes")),
      5 * 60 * 1000,
    );
  });

  const server = Bun.serve({
    port: OAUTH_PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/auth/callback") {
        return new Response("Not found", { status: 404 });
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") || error;
        rejectCallback!(new Error(desc));
        return new Response(HTML_ERROR(desc), {
          headers: { "Content-Type": "text/html" },
        });
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (!code || returnedState !== state) {
        const msg = !code ? "Missing authorization code" : "Invalid state parameter";
        rejectCallback!(new Error(msg));
        return new Response(HTML_ERROR(msg), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      // Exchange code for tokens asynchronously
      exchangeCodeForTokens(code, redirectUri, pkce.verifier)
        .then(resolveCallback!)
        .catch(rejectCallback!);

      return new Response(HTML_SUCCESS, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  return { promise, server };
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }
  return response.json();
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue;
    const claims = parseJwtClaims(token);
    if (!claims) continue;
    const id =
      (claims as Record<string, unknown>).chatgpt_account_id ||
      ((claims as Record<string, Record<string, unknown>>)["https://api.openai.com/auth"])?.chatgpt_account_id ||
      ((claims as Record<string, Array<{ id?: string }>>).organizations)?.[0]?.id;
    if (id) return id as string;
  }
  return undefined;
}

const HTML_SUCCESS = `<!doctype html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#111;color:#eee"><div style="text-align:center"><h1>Authenticated</h1><p>You can close this window.</p></div><script>setTimeout(()=>window.close(),2000)</script></body></html>`;

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HTML_ERROR = (msg: string) =>
  `<!doctype html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#111;color:#eee"><div style="text-align:center"><h1 style="color:#f44">Authentication Failed</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
