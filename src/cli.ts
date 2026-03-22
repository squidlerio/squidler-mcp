#!/usr/bin/env node

import { Command } from "commander";
import { downloadChrome } from "./chrome/download.js";
import { VERSION } from "./version.js";
import { clearStoredAuth } from "./auth/token-store.js";
import { authenticateWithOAuth } from "./auth/oauth.js";

const SQUIDLER_API_URL =
  process.env.SQUIDLER_API_URL || "https://mcp.squidler.io";

const program = new Command();

program
  .name("squidler-mcp")
  .description(
    "Squidler MCP proxy - enables testing localhost URLs via local Chrome",
  )
  .version(VERSION);

program
  .command("download-chrome")
  .description("Download Chrome headless shell for local testing")
  .option("--version <version>", "Chrome version to download")
  .action(async (options) => {
    console.log("Downloading Chrome...");

    try {
      const chromeInfo = await downloadChrome({
        version: options.version,
      });
      console.log(`\nChrome downloaded successfully!`);
      console.log(`Version: ${chromeInfo.version}`);
      console.log(`Path: ${chromeInfo.executablePath}`);
    } catch (error) {
      console.error("Failed to download Chrome:", error);
      process.exit(1);
    }
  });

program
  .command("mcp-proxy")
  .description(
    "Start MCP proxy (stdio transport) - proxies to remote Squidler MCP server with local Chrome session support",
  )
  .action(async () => {
    await import("./mcp-proxy-server.js");
  });

program
  .command("login")
  .description("Authenticate with Squidler via browser-based OAuth")
  .action(async () => {
    try {
      await authenticateWithOAuth(SQUIDLER_API_URL);
      console.error("Authentication successful! Token stored.");
    } catch (error) {
      console.error("Authentication failed:", error);
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Clear stored authentication credentials")
  .action(() => {
    clearStoredAuth(SQUIDLER_API_URL);
    console.error("Stored credentials cleared.");
  });

// Default to mcp-proxy when no subcommand is given (e.g. `npx @squidlerio/squidler-mcp`)
if (process.argv.length <= 2) {
  process.argv.push("mcp-proxy");
}

program.parse();
