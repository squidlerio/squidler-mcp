import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface StoredAuth {
  access_token: string;
  server_url: string;
  created_at: string;
  /** Absolute ISO-8601 expiry of access_token, derived from the token response's expires_in. */
  expires_at?: string;
  /** Rotating refresh token (RFC 6749 §6). Absent on records written before refresh support. */
  refresh_token?: string;
  /** DCR client the token pair was issued to — required to drive the refresh grant. */
  client_id?: string;
  /** DCR client secret (client_secret_post). Required for the refresh grant. */
  client_secret?: string;
}

interface AuthStore {
  [serverUrl: string]: StoredAuth;
}

export function getDataDir(): string {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "squidler");
}

function getAuthFilePath(): string {
  return path.join(getDataDir(), "auth.json");
}

function readStore(): AuthStore {
  const filePath = getAuthFilePath();
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as AuthStore;
  } catch {
    return {};
  }
}

function writeStore(store: AuthStore): void {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getAuthFilePath();
  // Write-then-rename so a crash mid-write can't leave a torn auth.json. This matters
  // for refresh: the server rotates and revokes the old pair, so a half-written record
  // would strand us with no usable token. rename(2) is atomic on the same filesystem.
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

export function loadStoredAuth(serverUrl: string): StoredAuth | null {
  const store = readStore();
  return store[serverUrl] || null;
}

export function saveStoredAuth(auth: StoredAuth): void {
  const store = readStore();
  store[auth.server_url] = auth;
  writeStore(store);
}

export function clearStoredAuth(serverUrl: string): void {
  const store = readStore();
  delete store[serverUrl];
  writeStore(store);
}
