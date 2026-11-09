/**
 * Chronicle — Session-bound viewer (E-1b).
 *
 * The ONLY source of tier in the app. A signed `chronicle_session` cookie is
 * verified on every read; there is no default tier and the legacy client-
 * selected tier header is never read. Rejects tampered, unsigned, or malformed
 * cookies by treating them as unauthenticated.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getUserById } from "./demo-users";
import type { DemoUser } from "./demo-users";

export interface Viewer {
  id: string;
  name: string;
  role: string;
  tier: 1 | 2 | 3;
}

export const SESSION_COOKIE = "chronicle_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h

const DEV_FALLBACK_SECRET = "chronicle-dev-session-secret-v1";

function sessionSecret(): string {
  const env = process.env.SESSION_SECRET;
  if (env && env.trim()) return env.trim();
  // Stable dev fallback (NOT per-request random; never shipped for production).
  console.warn("SESSION_SECRET not set; using dev fallback — do not use in production");
  return DEV_FALLBACK_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * In-memory revocation set for logged-out session tokens. Stateless HMAC
 * cookies cannot be invalidated server-side without a store, so logout adds the
 * exact token here; verification rejects it. Cleared on server restart, which
 * is consistent with the in-memory demo persistence.
 */
const revokedTokens = new Set<string>();

export function revokeSessionToken(token: string): void {
  if (token) revokedTokens.add(token);
}

export function readSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  return parseCookies(cookieHeader)[SESSION_COOKIE] ?? null;
}

export function parseSessionToken(token: string): { userId: string; issuedAt: number } | null {
  if (revokedTokens.has(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedAtStr, sig] = parts;
  if (!userId || !issuedAtStr || !sig) return null;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;

  const payload = `${userId}.${issuedAtStr}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;
  return { userId, issuedAt };
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

export async function getViewer(req: Request): Promise<Viewer | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const parsed = parseSessionToken(token);
  if (!parsed) return null;
  const user: DemoUser | null = getUserById(parsed.userId);
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.role, tier: user.tier };
}

export function sessionCookieHeader(token: string, opts?: { clear?: boolean }): string {
  const attrs = [
    `${SESSION_COOKIE}=${opts?.clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
    `Max-Age=${opts?.clear ? 0 : SESSION_MAX_AGE_SECONDS}`,
  ];
  return attrs.join("; ");
}
