#!/usr/bin/env node

import { startMCPProxy } from "./mcp-proxy.js";

const SQUIDLER_API_URL =
  process.env.SQUIDLER_API_URL || "https://mcp.squidler.io";
const SQUIDLER_API_KEY = process.env.SQUIDLER_API_KEY;

async function main() {
  if (!SQUIDLER_API_KEY) {
    console.error("SQUIDLER_API_KEY environment variable is required");
    process.exit(1);
  }

  await startMCPProxy({
    apiUrl: SQUIDLER_API_URL,
    apiKey: SQUIDLER_API_KEY,
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
