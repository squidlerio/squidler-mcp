#!/usr/bin/env node

import { Command } from "commander";
import { downloadChrome } from "./chrome/download.js";
import { VERSION } from "./version.js";

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

program.parse();
