#!/usr/bin/env node

import { setMaxListeners } from "events";
setMaxListeners(0);

import { startMCPProxy } from "./mcp-proxy.js";
import { loadStoredAuth } from "./auth/token-store.js";
import { authenticateWithOAuth } from "./auth/oauth.js";

const SQUIDLER_API_URL =
  process.env.SQUIDLER_API_URL || "https://mcp.squidler.io";

async function main() {
  await startMCPProxy({
    apiUrl: SQUIDLER_API_URL,
    resolveApiKey: async () => {
      const envKey = process.env.SQUIDLER_API_KEY;
      if (envKey) return envKey;

      const stored = loadStoredAuth(SQUIDLER_API_URL);
      if (stored) {
        console.error("Using stored authentication token");
        return stored.access_token;
      }

      console.error("No API key found. Starting browser authentication...");
      const token = await authenticateWithOAuth(SQUIDLER_API_URL);
      console.error("Authentication successful!");
      return token;
    },
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
