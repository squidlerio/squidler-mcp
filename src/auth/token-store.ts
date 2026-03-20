import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface StoredAuth {
  access_token: string;
  server_url: string;
  created_at: string;
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
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
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
