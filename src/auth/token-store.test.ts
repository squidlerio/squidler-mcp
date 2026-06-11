import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clearStoredAuth,
  getDataDir,
  loadStoredAuth,
  saveStoredAuth,
  StoredAuth,
} from "./token-store.js";

const SERVER = "https://mcp.squidler.io";
let tmpDir: string;
let prevXdg: string | undefined;

beforeEach(() => {
  prevXdg = process.env.XDG_DATA_HOME;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squidler-token-store-"));
  process.env.XDG_DATA_HOME = tmpDir;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("round-trips the full token state including refresh fields", () => {
  const auth: StoredAuth = {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: "2026-06-11T12:00:00.000Z",
    client_id: "client-789",
    client_secret: "secret-abc",
    server_url: SERVER,
    created_at: "2026-06-11T11:00:00.000Z",
  };

  saveStoredAuth(auth);

  expect(loadStoredAuth(SERVER)).toEqual(auth);
});

test("writes auth.json under the XDG data dir with 0600 permissions", () => {
  saveStoredAuth({
    access_token: "a",
    refresh_token: "r",
    expires_at: "2026-06-11T12:00:00.000Z",
    client_id: "c",
    client_secret: "s",
    server_url: SERVER,
    created_at: "2026-06-11T11:00:00.000Z",
  });

  const file = path.join(getDataDir(), "auth.json");
  expect(fs.existsSync(file)).toBe(true);
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
});

test("loads a pre-refresh (old-shape) record without crashing", () => {
  // Simulate an auth.json written by an older version: no refresh_token/expires_at/client_*.
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(
    path.join(getDataDir(), "auth.json"),
    JSON.stringify(
      {
        [SERVER]: {
          access_token: "legacy-token",
          server_url: SERVER,
          created_at: "2026-06-05T08:00:00.000Z",
        },
      },
      null,
      2,
    ),
  );

  const loaded = loadStoredAuth(SERVER);
  expect(loaded).not.toBeNull();
  expect(loaded!.access_token).toBe("legacy-token");
  expect(loaded!.refresh_token).toBeUndefined();
  expect(loaded!.expires_at).toBeUndefined();
  expect(loaded!.client_id).toBeUndefined();
});

test("returns null for an unknown server and for a missing file", () => {
  expect(loadStoredAuth("https://other.example.com")).toBeNull();
});

test("keeps other servers' entries when saving and clearing", () => {
  const other = "https://api.dev.squidler.io";
  saveStoredAuth({
    access_token: "a1",
    server_url: SERVER,
    created_at: "2026-06-11T11:00:00.000Z",
  });
  saveStoredAuth({
    access_token: "a2",
    server_url: other,
    created_at: "2026-06-11T11:00:00.000Z",
  });

  expect(loadStoredAuth(SERVER)!.access_token).toBe("a1");
  expect(loadStoredAuth(other)!.access_token).toBe("a2");

  clearStoredAuth(SERVER);
  expect(loadStoredAuth(SERVER)).toBeNull();
  expect(loadStoredAuth(other)!.access_token).toBe("a2");
});

test("overwrites the record for a server on re-save", () => {
  saveStoredAuth({
    access_token: "old",
    refresh_token: "old-r",
    server_url: SERVER,
    created_at: "2026-06-11T11:00:00.000Z",
  });
  saveStoredAuth({
    access_token: "new",
    refresh_token: "new-r",
    expires_at: "2026-06-11T13:00:00.000Z",
    client_id: "c",
    client_secret: "s",
    server_url: SERVER,
    created_at: "2026-06-11T12:00:00.000Z",
  });

  const loaded = loadStoredAuth(SERVER)!;
  expect(loaded.access_token).toBe("new");
  expect(loaded.refresh_token).toBe("new-r");
  expect(loaded.expires_at).toBe("2026-06-11T13:00:00.000Z");
});
