import { StoredAuth, loadStoredAuth, clearStoredAuth } from "./token-store.js";
import { authenticateWithOAuth, refreshAccessToken } from "./oauth.js";

/** Refresh proactively when the access token is within this window of expiring. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * True if the access token is past (or about to pass) its expiry, or if the record predates
 * refresh support (no expires_at) — in which case it has no refresh token either and must be
 * re-acquired via the browser flow.
 */
export function isExpiredOrExpiring(
  stored: StoredAuth,
  nowMs: number = Date.now(),
): boolean {
  if (!stored.expires_at) return true;
  const expiresAtMs = Date.parse(stored.expires_at);
  if (Number.isNaN(expiresAtMs)) return true;
  return nowMs >= expiresAtMs - EXPIRY_SKEW_MS;
}

export interface AuthProvider {
  /** A bearer token to use now, refreshing proactively if it is near expiry. */
  getToken(): Promise<string>;
  /** Recover from a 401: refresh if possible, otherwise re-run the browser flow. */
  reauthorize(): Promise<string>;
}

/**
 * Backs SQUIDLER_API_KEY. The key is a static personal token with no refresh path, so a 401
 * means the key itself is bad — surfacing that beats silently looping on a dead credential.
 */
export class StaticApiKeyAuthProvider implements AuthProvider {
  constructor(private readonly apiKey: string) {}

  async getToken(): Promise<string> {
    return this.apiKey;
  }

  async reauthorize(): Promise<string> {
    throw new Error(
      "SQUIDLER_API_KEY was rejected (401). Update the environment variable with a valid key.",
    );
  }
}

/**
 * OAuth-backed auth: proactively refreshes before expiry, recovers from 401s by refreshing,
 * and falls back to the browser flow exactly once when there is no usable refresh token. The
 * fallback never loops — a refresh is attempted at most once before re-authenticating, and the
 * browser flow either yields a fresh token or throws.
 */
export class OAuthAuthProvider implements AuthProvider {
  constructor(private readonly serverUrl: string) {}

  async getToken(): Promise<string> {
    const stored = loadStoredAuth(this.serverUrl);
    if (!stored) {
      console.error("No stored credentials. Starting browser authentication...");
      return authenticateWithOAuth(this.serverUrl);
    }
    if (isExpiredOrExpiring(stored)) {
      return this.renew(stored);
    }
    console.error("Using stored authentication token");
    return stored.access_token;
  }

  async reauthorize(): Promise<string> {
    return this.renew(loadStoredAuth(this.serverUrl));
  }

  /** Refresh if we hold a usable refresh token; otherwise clear and re-run the browser flow. */
  private async renew(stored: StoredAuth | null): Promise<string> {
    if (stored?.refresh_token && stored.client_id) {
      try {
        console.error("Refreshing access token...");
        const refreshed = await refreshAccessToken(this.serverUrl, stored);
        return refreshed.access_token;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Token refresh failed (${msg}); re-authenticating via browser...`);
      }
    }
    clearStoredAuth(this.serverUrl);
    return authenticateWithOAuth(this.serverUrl);
  }
}
