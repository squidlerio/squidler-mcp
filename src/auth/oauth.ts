import * as crypto from "crypto";
import * as os from "os";
import { spawnSync } from "child_process";
import { startCallbackServer } from "./callback-server.js";
import { saveStoredAuth } from "./token-store.js";

interface OAuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

async function discover(serverUrl: string): Promise<OAuthServerMetadata> {
  const res = await fetch(`${serverUrl}/.well-known/oauth-authorization-server`);
  if (!res.ok) {
    throw new Error(`OAuth discovery failed: HTTP ${res.status}`);
  }
  const metadata = (await res.json()) as OAuthServerMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) {
    throw new Error("OAuth discovery response missing required endpoints");
  }
  return metadata;
}

async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<{ client_id: string; client_secret: string }> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "squidler-mcp-cli",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  if (!res.ok) {
    throw new Error(`Client registration failed: HTTP ${res.status}`);
  }
  return (await res.json()) as { client_id: string; client_secret: string };
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function openBrowser(url: string): boolean {
  const platform = os.platform();

  const commands: [string, string[]][] =
    platform === "darwin"
      ? [["open", [url]]]
      : platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [
            ["xdg-open", [url]],
            ["sensible-browser", [url]],
            ["x-www-browser", [url]],
          ];

  for (const [cmd, args] of commands) {
    const result = spawnSync(cmd, args, { stdio: "ignore", timeout: 5000 });
    if (!result.error && result.status === 0) {
      return true;
    }
  }

  return false;
}

async function exchangeToken(
  tokenEndpoint: string,
  params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    codeVerifier: string;
  },
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: HTTP ${res.status} - ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) {
    throw new Error("Token response missing access_token");
  }
  return data.access_token;
}

export async function authenticateWithOAuth(serverUrl: string): Promise<string> {
  // 1. Discovery
  console.error("Discovering OAuth endpoints...");
  const metadata = await discover(serverUrl);

  // 2. Start callback server
  const callback = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${callback.port}/callback`;

  try {
    // 3. DCR registration
    console.error("Registering client...");
    const client = await registerClient(metadata.registration_endpoint, redirectUri);

    // 4. PKCE
    const pkce = generatePKCE();
    const state = crypto.randomBytes(16).toString("base64url");

    // 5. Build authorization URL and open browser
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", client.client_id);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", pkce.challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    // Open the onboarding page instead of the OAuth endpoint directly
    const connectUrl = new URL("/mcp/connect", new URL(metadata.authorization_endpoint).origin);
    connectUrl.searchParams.set("response_type", "code");
    connectUrl.searchParams.set("client_id", client.client_id);
    connectUrl.searchParams.set("redirect_uri", redirectUri);
    connectUrl.searchParams.set("state", state);
    connectUrl.searchParams.set("code_challenge", pkce.challenge);
    connectUrl.searchParams.set("code_challenge_method", "S256");

    const opened = openBrowser(connectUrl.toString());
    if (opened) {
      console.error("Browser opened for authentication. Waiting...");
    } else {
      console.error(
        `Open this URL in your browser to authenticate:\n\n  ${authUrl.toString()}\n\nWaiting for authentication...`,
      );
    }

    // 6. Wait for callback and validate state
    const result = await callback.waitForCallback();
    if (result.state !== state) {
      throw new Error("OAuth state mismatch — possible CSRF attack");
    }

    // 7. Token exchange
    console.error("Exchanging authorization code for token...");
    const accessToken = await exchangeToken(metadata.token_endpoint, {
      code: result.code,
      redirectUri,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      codeVerifier: pkce.verifier,
    });

    // 8. Save token
    saveStoredAuth({
      access_token: accessToken,
      server_url: serverUrl,
      created_at: new Date().toISOString(),
    });

    return accessToken;
  } finally {
    callback.close();
  }
}
