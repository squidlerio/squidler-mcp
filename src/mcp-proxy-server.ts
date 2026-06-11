#!/usr/bin/env node

import { setMaxListeners } from "events";
setMaxListeners(0);

import { startMCPProxy } from "./mcp-proxy.js";
import {
  AuthProvider,
  OAuthAuthProvider,
  StaticApiKeyAuthProvider,
} from "./auth/auth-provider.js";

const SQUIDLER_API_URL =
  process.env.SQUIDLER_API_URL || "https://mcp.squidler.io";

async function main() {
  // A static SQUIDLER_API_KEY takes precedence; otherwise drive the OAuth flow with refresh.
  const envKey = process.env.SQUIDLER_API_KEY;
  const auth: AuthProvider = envKey
    ? new StaticApiKeyAuthProvider(envKey)
    : new OAuthAuthProvider(SQUIDLER_API_URL);

  await startMCPProxy({
    apiUrl: SQUIDLER_API_URL,
    auth,
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
