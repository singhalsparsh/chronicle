/**
 * Chronicle — Session secret resolution.
 *
 * Separated from get-viewer.ts so the fail-closed production behavior is a
 * pure, unit-testable function with no imports.
 */

export const DEV_FALLBACK_SECRET = "chronicle-dev-session-secret-v1";

/**
 * Resolves the session HMAC secret.
 * - Uses SESSION_SECRET when set.
 * - Fails closed in production when it is missing: a predictable default would
 *   let anyone forge a T3 session cookie.
 * - Outside production, falls back to a stable dev secret (with a warning).
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.SESSION_SECRET;
  if (value && value.trim()) return value.trim();
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  console.warn("SESSION_SECRET not set; using dev fallback — do not use in production");
  return DEV_FALLBACK_SECRET;
}
