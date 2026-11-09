/**
 * Chronicle — API smoke test (runs against a running server, default
 * localhost:3000). Covers the security-critical invariants:
 *   1. Unauthenticated data routes return 401.
 *   2. T1 (Jordan) is blocked from lock_snapshot with 403 FORBIDDEN.
 *   3. T1 receives 0 claims above tier 1 (and no T3 source SLK-240) in JSON.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function req(method, path, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, text, data, setCookie: res.headers.get("set-cookie") };
}

let pass = 0;
function ok(name, cond, extra = "") {
  if (!cond) throw new Error(`FAIL: ${name} ${extra}`);
  pass += 1;
  console.log(`PASS ${name}`);
}

// 1. Unauthenticated -> 401
let r = await req("GET", "/api/reconstruct");
ok("unauthenticated GET /api/reconstruct -> 401", r.status === 401, `got ${r.status}`);
r = await req("GET", "/api/handover/export");
ok("unauthenticated GET /api/handover/export -> 401", r.status === 401, `got ${r.status}`);

// Login as Jordan (T1)
const login = await req("POST", "/api/session", { body: { userId: "jordan" } });
ok("login jordan -> 200 with Set-Cookie", login.status === 200 && Boolean(login.setCookie), `got ${login.status}`);
const cookie = login.setCookie.split(";")[0];

// 2. T1 state has zero over-tier claims and no T3 source
r = await req("GET", "/api/reconstruct", { cookie });
ok("T1 GET /api/reconstruct -> 200", r.status === 200, `got ${r.status}`);
const state = r.data.state;
const overTier = state.claims.filter((c) => c.accessTier > 1).map((c) => c.id);
ok("T1 has 0 claims with accessTier > 1", overTier.length === 0, JSON.stringify(overTier));
ok("T1 wire contains no T3 source SLK-240", !r.text.includes("SLK-240"));

// 3. T1 lock_snapshot -> 403
r = await req("POST", "/api/handover", { cookie, body: { action: "lock_snapshot" } });
ok(
  "T1 lock_snapshot -> 403 FORBIDDEN",
  r.status === 403 && r.data?.error?.code === "FORBIDDEN",
  `got ${r.status} ${JSON.stringify(r.data)}`
);

console.log(`\nAll smoke checks passed (${pass}/3).`);
