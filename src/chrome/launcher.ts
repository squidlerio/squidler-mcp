import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { downloadChrome } from "./download.js";

export interface ChromeLaunchOptions {
  /**
   * Path to Chrome executable. If not provided, will download or find system Chrome.
   */
  executablePath?: string;

  /**
   * Port for Chrome DevTools Protocol. If not provided, a free port will be found.
   */
  port?: number;

  /**
   * Run Chrome in headless mode. Default: true
   */
  headless?: boolean;

  /**
   * User data directory. If not provided, a temp directory will be created.
   */
  userDataDir?: string;

  /**
   * Window width. Default: 1920
   */
  width?: number;

  /**
   * Window height. Default: 1080
   */
  height?: number;

  /**
   * Additional Chrome arguments.
   */
  args?: string[];
}

export interface ChromeInstance {
  wsEndpoint: string;
  pid: number;
  port: number;
  process: ChildProcess;
  userDataDir: string;
  close(): Promise<void>;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not get port"));
      }
    });
  });
}

function extractWsEndpoint(process: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for Chrome to start"));
    }, 30000);

    const pattern = /DevTools listening on (ws:\/\/[^\s]+)/;

    const onData = (data: Buffer) => {
      const text = data.toString();
      const match = pattern.exec(text);
      if (match) {
        clearTimeout(timeout);
        process.stderr?.off("data", onData);
        process.stdout?.off("data", onData);
        resolve(match[1]);
      }
    };

    process.stderr?.on("data", onData);
    process.stdout?.on("data", onData);

    process.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    process.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Chrome exited with code ${code}`));
      }
    });
  });
}

export async function launchChrome(
  options: ChromeLaunchOptions = {},
): Promise<ChromeInstance> {
  // Get Chrome executable
  let executablePath = options.executablePath;

  if (!executablePath) {
    const chromeInfo = await downloadChrome();
    executablePath = chromeInfo.executablePath;
  }

  // Find a free port
  const port = options.port || (await findFreePort());

  // Create temp user data directory
  const userDataDir =
    options.userDataDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), "squidler-chrome-"));

  // Chrome arguments
  // Based on Chrome.kt flags for compatibility
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1", // Security: only localhost
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-domain-reliability",
    "--disable-extensions",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--disable-translate",
    "--disable-web-security", // Needed for cross-domain iframe access
    "--disable-site-isolation-trials",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-sandbox", // Required for some environments
    "--safebrowsing-disable-auto-update",
    `--window-size=${options.width || 1920},${options.height || 1080}`,
  ];

  // Add headless flag
  if (options.headless !== false) {
    args.push("--headless=new");
  }

  // Add any additional args
  if (options.args) {
    args.push(...options.args);
  }

  console.error(`Launching Chrome on port ${port}...`);

  // Launch Chrome
  const chromeProcess = spawn(executablePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  // Wait for WebSocket endpoint
  const wsEndpoint = await extractWsEndpoint(chromeProcess);

  console.error(`Chrome started: ${wsEndpoint}`);

  // Cleanup function
  const close = async (): Promise<void> => {
    return new Promise((resolve) => {
      if (chromeProcess.killed) {
        resolve();
        return;
      }

      chromeProcess.on("exit", () => {
        // Clean up user data dir
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
        resolve();
      });

      // Try graceful shutdown first
      chromeProcess.kill("SIGTERM");

      // Force kill after timeout
      setTimeout(() => {
        if (!chromeProcess.killed) {
          chromeProcess.kill("SIGKILL");
        }
      }, 5000);
    });
  };

  // At this point Chrome has started (we have a WebSocket endpoint), so PID should exist
  const pid = chromeProcess.pid;
  if (pid === undefined) {
    throw new Error(
      "Chrome process started but has no PID - this should not happen",
    );
  }

  return {
    wsEndpoint,
    pid,
    port,
    process: chromeProcess,
    userDataDir,
    close,
  };
}
