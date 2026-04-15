import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getActiveSession, startSession, stopSession } from "./cdp/session.js";
import { VERSION } from "./version.js";

export interface MCPProxyOptions {
  apiUrl: string;
  apiKey?: string;
  resolveApiKey?: () => Promise<string>;
}

interface LocalChromeSettings {
  headless: boolean;
}

function toolResult(text: string, isError?: boolean) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

function deriveCdpProxyUrl(apiUrl: string): string {
  // api.dev.squidler.io → cdp-proxy.dev.squidler.io
  // mcp.squidler.io → cdp-proxy.squidler.io
  // api.squidler.io → cdp-proxy.squidler.io
  const url = new URL(apiUrl);
  const parts = url.hostname.split(".");
  // Replace the service subdomain (api, mcp) with cdp-proxy
  if (["api", "mcp"].includes(parts[0])) {
    parts[0] = "cdp-proxy";
  } else {
    parts.splice(0, 0, "cdp-proxy");
  }
  return `wss://${parts.join(".")}`;
}

export async function startMCPProxy(options: MCPProxyOptions): Promise<void> {
  const { apiUrl } = options;
  const mcpUrl = apiUrl;
  const cdpProxyUrl = deriveCdpProxyUrl(apiUrl);

  let localChromeSettings: LocalChromeSettings | null = null;
  let remoteClient: Client | null = null;
  let resolvedApiKey: string | undefined;

  async function getApiKey(): Promise<string> {
    if (resolvedApiKey) return resolvedApiKey;
    if (options.apiKey) {
      resolvedApiKey = options.apiKey;
    } else if (options.resolveApiKey) {
      resolvedApiKey = await options.resolveApiKey();
    } else {
      throw new Error("No API key configured. Set SQUIDLER_API_KEY or run: squidler-mcp login");
    }
    return resolvedApiKey;
  }

  async function connectRemote(): Promise<Client> {
    const apiKey = await getApiKey();
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Squidler-Client": "npm-proxy",
          "User-Agent": `squidler-mcp/${VERSION}`,
        },
      },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 30000,
        maxReconnectionDelay: 60000,
        reconnectionDelayGrowFactor: 2,
      },
    });

    const client = new Client({
      name: "squidler-local-proxy",
      version: VERSION,
    });

    client.onerror = (error) => {
      console.error("Remote MCP client error:", error.message);
    };

    client.onclose = () => {
      console.error("Remote MCP connection closed");
    };

    await client.connect(transport);
    console.error("Connected to remote MCP server");
    return client;
  }

  async function ensureRemote(): Promise<Client> {
    if (!remoteClient) {
      remoteClient = await connectRemote();
    }
    return remoteClient;
  }

  async function withReconnect<T>(
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = await ensureRemote();
    try {
      return await fn(client);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Session not found") || msg.includes("fetch failed")) {
        console.error(`Remote session lost (${msg}), reconnecting...`);
        try {
          await client.close();
        } catch {}
        remoteClient = await connectRemote();
        return await fn(remoteClient);
      }
      throw error;
    }
  }

  async function runWithLocalChrome(request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }) {
    const existingSession = getActiveSession();
    if (existingSession) {
      console.error("Recycling CDP session for clean test environment...");
      await stopSession();
    }

    const freshSession = await startSession(cdpProxyUrl, {
      headless: localChromeSettings!.headless,
    });

    return await withReconnect((c) =>
      c.callTool({
        name: request.params.name,
        arguments: {
          ...request.params.arguments,
          cdpProxyUrl: freshSession.remoteUrl,
        },
      }),
    );
  }

  const localServer = new Server(
    { name: "squidler", version: VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  localServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const remoteResult = await withReconnect((c) => c.listTools());

    const localTools = [
      {
        name: "local_session_start",
        description:
          "Start a local Chrome session for testing localhost URLs. Launches Chrome and connects it to the CDP proxy so cloud tests can control it.",
        inputSchema: {
          type: "object" as const,
          properties: {
            headless: {
              type: "boolean",
              description: "Run Chrome in headless mode (default: true)",
            },
          },
        },
      },
      {
        name: "local_session_stop",
        description: "Stop the local Chrome session and clean up resources.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "local_session_status",
        description: "Check the status of the local Chrome session.",
        inputSchema: { type: "object" as const, properties: {} },
      },
    ];

    return { tools: [...remoteResult.tools, ...localTools] };
  });

  localServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case "local_session_start": {
        const headless = request.params.arguments?.headless !== false;
        localChromeSettings = { headless };
        return toolResult(
          JSON.stringify({
            status: "enabled",
            headless,
            message:
              "Local Chrome mode enabled. Tests will now run against your local Chrome.",
          }),
        );
      }

      case "local_session_stop": {
        localChromeSettings = null;
        await stopSession();
        return toolResult(
          JSON.stringify({
            status: "stopped",
            message: "Local Chrome mode disabled and session stopped.",
          }),
        );
      }

      case "local_session_status": {
        const session = getActiveSession();
        return toolResult(
          JSON.stringify({
            localChrome: localChromeSettings ? "enabled" : "disabled",
            ...(localChromeSettings ?? {}),
            session: session
              ? { status: "active", sessionId: session.sessionId }
              : { status: "inactive" },
          }),
        );
      }

      case "test_case_run":
      case "test_cases_run_all":
      case "test_cases_run_by_label": {
        if (localChromeSettings) {
          return await runWithLocalChrome(request);
        }
        break;
      }
    }

    // Forward all other tool calls to remote
    return await withReconnect((c) =>
      c.callTool({
        name,
        arguments: request.params.arguments,
      }),
    );
  });

  localServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    return await withReconnect((c) => c.listResources());
  });

  localServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return await withReconnect((c) =>
      c.readResource({ uri: request.params.uri }),
    );
  });

  localServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    return await withReconnect((c) => c.listPrompts());
  });

  localServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return await withReconnect((c) =>
      c.getPrompt({
        name: request.params.name,
        arguments: request.params.arguments,
      }),
    );
  });

  const stdioTransport = new StdioServerTransport();
  await localServer.connect(stdioTransport);

  console.error("Squidler MCP proxy started");
  console.error(`Remote: ${apiUrl}`);
  console.error(`CDP Proxy: ${cdpProxyUrl}`);

  process.on("SIGINT", async () => {
    await stopSession();
    await localServer.close();
    await remoteClient?.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopSession();
    await localServer.close();
    await remoteClient?.close();
    process.exit(0);
  });
}
