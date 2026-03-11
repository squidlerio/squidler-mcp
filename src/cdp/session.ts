import WebSocket from "ws";
import {
  launchChrome,
  ChromeInstance,
  ChromeLaunchOptions,
} from "../chrome/launcher.js";
import { downloadChrome } from "../chrome/download.js";
import { VERSION } from "../version.js";

export interface CDPSession {
  sessionId: string;
  localUrl: string;
  remoteUrl: string;
  chrome: ChromeInstance | null;
  chromeWs: WebSocket | null;
  proxyWs: WebSocket | null;
  pingInterval: ReturnType<typeof setInterval> | null;
  headless: boolean;
}

let activeSession: CDPSession | null = null;

export interface SessionCreateResponse {
  sessionId: string;
  localUrl: string;
  remoteUrl: string;
}

async function createProxySession(
  cdpProxyBaseUrl: string,
): Promise<SessionCreateResponse> {
  const url = `${cdpProxyBaseUrl.replace(/^ws/, "http")}/session`;
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `Failed to create CDP proxy session: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as SessionCreateResponse;
}

function waitForOpen(ws: WebSocket, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout connecting to ${name}`));
    }, 30000);

    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to ${name}: ${err.message}`));
    });
  });
}

export async function startSession(
  cdpProxyBaseUrl: string,
  chromeOptions?: ChromeLaunchOptions,
): Promise<CDPSession> {
  if (activeSession) {
    throw new Error("Session already active. Stop it first.");
  }

  // 1. Query required Chrome version from CDP proxy
  console.error("Querying CDP proxy for Chrome version...");
  const versionsUrl = `${cdpProxyBaseUrl.replace(/^ws/, "http")}/versions`;
  const versionsResponse = await fetch(versionsUrl);
  if (!versionsResponse.ok) {
    throw new Error(
      `Failed to query CDP proxy versions: ${versionsResponse.status}`,
    );
  }
  const versions = (await versionsResponse.json()) as {
    chrome: string;
    mcpServer: string;
  };
  console.error(`Required Chrome version: ${versions.chrome}`);

  if (versions.mcpServer !== VERSION) {
    console.error(
      `WARNING: CDP proxy expects MCP server ${versions.mcpServer}, running ${VERSION}. Please update your MCP server.`,
    );
  }

  // 2. Download matching Chrome version
  const chromeInfo = await downloadChrome({ version: versions.chrome });
  console.error(`Chrome ready: ${chromeInfo.version}`);

  // 3. Create session on CDP proxy
  console.error("Creating CDP proxy session...");
  const sessionInfo = await createProxySession(cdpProxyBaseUrl);
  console.error(`Session created: ${sessionInfo.sessionId}`);

  // 4. Launch local Chrome with the matching version
  console.error("Launching local Chrome...");
  const chrome = await launchChrome({
    ...chromeOptions,
    executablePath: chromeInfo.executablePath,
  });
  console.error(`Chrome launched on port ${chrome.port}`);

  // 5. Connect Chrome to the proxy's local WebSocket
  let chromeWs: WebSocket;
  let proxyWs: WebSocket;
  try {
    console.error(`Connecting to Chrome: ${chrome.wsEndpoint}`);
    chromeWs = new WebSocket(chrome.wsEndpoint);
    await waitForOpen(chromeWs, "Chrome");

    console.error(`Connecting to CDP proxy: ${sessionInfo.localUrl}`);
    proxyWs = new WebSocket(sessionInfo.localUrl);
    await waitForOpen(proxyWs, "CDP proxy");
  } catch (error) {
    console.error("Failed to connect WebSockets, cleaning up Chrome...");
    await chrome.close();
    throw error;
  }

  // 6. Set up bidirectional relay (pure CDP, no Squidler protocol)
  proxyWs.on("message", (data, isBinary) => {
    if (chromeWs.readyState === WebSocket.OPEN) {
      chromeWs.send(data, { binary: isBinary });
    }
  });

  chromeWs.on("message", (data, isBinary) => {
    if (proxyWs.readyState === WebSocket.OPEN) {
      proxyWs.send(data, { binary: isBinary });
    }
  });

  // Handle disconnections
  proxyWs.on("close", () => {
    console.error("CDP proxy connection closed");
  });

  chromeWs.on("close", () => {
    console.error("Chrome connection closed");
  });

  proxyWs.on("error", (err) => {
    console.error("CDP proxy WebSocket error:", err.message);
  });

  chromeWs.on("error", (err) => {
    console.error("Chrome WebSocket error:", err.message);
  });

  // Keep alive
  const pingInterval = setInterval(() => {
    if (proxyWs.readyState === WebSocket.OPEN) proxyWs.ping();
    if (chromeWs.readyState === WebSocket.OPEN) chromeWs.ping();
  }, 30000);

  activeSession = {
    sessionId: sessionInfo.sessionId,
    localUrl: sessionInfo.localUrl,
    remoteUrl: sessionInfo.remoteUrl,
    chrome,
    chromeWs,
    proxyWs,
    pingInterval,
    headless: chromeOptions?.headless !== false,
  };

  console.error("CDP session established");
  return activeSession;
}

export async function stopSession(): Promise<void> {
  if (!activeSession) return;

  const session = activeSession;
  activeSession = null;

  console.error("Stopping CDP session...");

  if (session.pingInterval) {
    clearInterval(session.pingInterval);
  }

  try {
    session.proxyWs?.close(1000, "Session stopped");
  } catch {}
  try {
    session.chromeWs?.close(1000, "Session stopped");
  } catch {}
  try {
    await session.chrome?.close();
  } catch {}

  console.error("CDP session stopped");
}

export function getActiveSession(): CDPSession | null {
  return activeSession;
}
