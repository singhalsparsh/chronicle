import test from "node:test";
import assert from "node:assert/strict";
import { resolveSessionSecret, DEV_FALLBACK_SECRET } from "../../src/lib/auth/session-secret.ts";

test("uses SESSION_SECRET when set", () => {
  assert.equal(resolveSessionSecret({ SESSION_SECRET: "  real-secret  ", NODE_ENV: "production" }), "real-secret");
});

test("fail-closed in production: throws instead of using dev fallback", () => {
  assert.throws(
    () => resolveSessionSecret({ NODE_ENV: "production" }),
    /SESSION_SECRET must be set in production/
  );
  assert.throws(
    () => resolveSessionSecret({ SESSION_SECRET: "   ", NODE_ENV: "production" }),
    /SESSION_SECRET must be set in production/
  );
});

test("dev fallback allowed outside production", () => {
  const secret = resolveSessionSecret({ NODE_ENV: "development" });
  assert.equal(secret, DEV_FALLBACK_SECRET);
});

test("default env (undefined) behaves as dev", () => {
  assert.equal(resolveSessionSecret(), DEV_FALLBACK_SECRET);
});
