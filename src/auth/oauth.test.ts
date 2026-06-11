import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { refreshAccessToken } from "./oauth.js";
import { loadStoredAuth, saveStoredAuth } from "./token-store.js";

let tmpDir: string;
let prevXdg: string | undefined;
let server: http.Server;
let serverUrl: string;
let lastRefreshBody: URLSearchParams | null;

beforeEach(async () => {
  prevXdg = process.env.XDG_DATA_HOME;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squidler-oauth-"));
  process.env.XDG_DATA_HOME = tmpDir;
  lastRefreshBody = null;

  server = http.createServer((req, res) => {
    if (req.url === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          authorization_endpoint: `${serverUrl}/oauth/authorize`,
          token_endpoint: `${serverUrl}/oauth/token`,
          registration_endpoint: `${serverUrl}/oauth/register`,
        }),
      );
      return;
    }
    if (req.url === "/oauth/token") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        lastRefreshBody = new URLSearchParams(raw);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "new-access",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "new-refresh",
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("refreshAccessToken sends the refresh grant with client credentials", async () => {
  saveStoredAuth({
    access_token: "old-access",
    refresh_token: "old-refresh",
    expires_at: "2026-06-11T11:00:00.000Z",
    client_id: "client-1",
    client_secret: "secret-1",
    server_url: serverUrl,
    created_at: "2026-06-11T10:00:00.000Z",
  });

  await refreshAccessToken(serverUrl, loadStoredAuth(serverUrl)!);

  expect(lastRefreshBody).not.toBeNull();
  expect(lastRefreshBody!.get("grant_type")).toBe("refresh_token");
  expect(lastRefreshBody!.get("refresh_token")).toBe("old-refresh");
  expect(lastRefreshBody!.get("client_id")).toBe("client-1");
  expect(lastRefreshBody!.get("client_secret")).toBe("secret-1");
});

test("refreshAccessToken persists the rotated pair immediately", async () => {
  saveStoredAuth({
    access_token: "old-access",
    refresh_token: "old-refresh",
    expires_at: "2026-06-11T11:00:00.000Z",
    client_id: "client-1",
    client_secret: "secret-1",
    server_url: serverUrl,
    created_at: "2026-06-11T10:00:00.000Z",
  });

  const before = Date.now();
  const returned = await refreshAccessToken(serverUrl, loadStoredAuth(serverUrl)!);
  const after = Date.now();

  // Returned record carries the rotated pair...
  expect(returned.access_token).toBe("new-access");
  expect(returned.refresh_token).toBe("new-refresh");
  expect(returned.client_id).toBe("client-1");
  expect(returned.client_secret).toBe("secret-1");

  // ...expires_at derived from expires_in (3600s out, within the call window)...
  const expMs = Date.parse(returned.expires_at!);
  expect(expMs).toBeGreaterThanOrEqual(before + 3600_000);
  expect(expMs).toBeLessThanOrEqual(after + 3600_000);

  // ...and it is on disk before the function returned (not just in memory).
  const persisted = loadStoredAuth(serverUrl)!;
  expect(persisted.access_token).toBe("new-access");
  expect(persisted.refresh_token).toBe("new-refresh");
});

test("refreshAccessToken rejects a record with no refresh token", async () => {
  const stored = {
    access_token: "legacy",
    server_url: serverUrl,
    created_at: "2026-06-05T08:00:00.000Z",
  };
  let err: unknown;
  try {
    await refreshAccessToken(serverUrl, stored);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/no refresh_token\/client_id/);
});

test("refreshAccessToken throws on a server rejection (expired/revoked)", async () => {
  // Swap the handler to 400 invalid_grant, as the server does for a dead refresh token.
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    if (req.url === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          authorization_endpoint: `${serverUrl}/oauth/authorize`,
          token_endpoint: `${serverUrl}/oauth/token`,
          registration_endpoint: `${serverUrl}/oauth/register`,
        }),
      );
      return;
    }
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "invalid_grant", error_description: "Refresh token has expired" }),
    );
  });

  let err: unknown;
  try {
    await refreshAccessToken(serverUrl, {
      access_token: "old-access",
      refresh_token: "dead-refresh",
      client_id: "client-1",
      client_secret: "secret-1",
      server_url: serverUrl,
      created_at: "2026-06-11T10:00:00.000Z",
    });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/Token refresh failed: HTTP 400/);
});
