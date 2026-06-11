import { expect, test } from "bun:test";
import { isExpiredOrExpiring } from "./auth-provider.js";
import { StoredAuth } from "./token-store.js";

const NOW = Date.parse("2026-06-11T12:00:00.000Z");

function record(expires_at?: string): StoredAuth {
  return {
    access_token: "a",
    refresh_token: "r",
    expires_at,
    client_id: "c",
    client_secret: "s",
    server_url: "https://mcp.squidler.io",
    created_at: "2026-06-11T11:00:00.000Z",
  };
}

test("treats a record with no expires_at (old shape) as expired", () => {
  expect(isExpiredOrExpiring(record(undefined), NOW)).toBe(true);
});

test("treats an unparseable expires_at as expired", () => {
  expect(isExpiredOrExpiring(record("not-a-date"), NOW)).toBe(true);
});

test("is expired when expires_at is in the past", () => {
  expect(isExpiredOrExpiring(record("2026-06-11T11:59:00.000Z"), NOW)).toBe(true);
});

test("is expiring within the 60s skew window", () => {
  // 30s from now → inside the 60s proactive-refresh window.
  expect(isExpiredOrExpiring(record("2026-06-11T12:00:30.000Z"), NOW)).toBe(true);
});

test("is not expiring when comfortably in the future", () => {
  // 10 minutes out → well outside the skew window.
  expect(isExpiredOrExpiring(record("2026-06-11T12:10:00.000Z"), NOW)).toBe(false);
});

test("treats the exact skew boundary as expiring", () => {
  // Exactly 60s out: nowMs >= expiresAtMs - 60_000 holds, so refresh.
  expect(isExpiredOrExpiring(record("2026-06-11T12:01:00.000Z"), NOW)).toBe(true);
});

test("is not expiring just outside the skew boundary", () => {
  // 61s out → just outside the window.
  expect(isExpiredOrExpiring(record("2026-06-11T12:01:01.000Z"), NOW)).toBe(false);
});
