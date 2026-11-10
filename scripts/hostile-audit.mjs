/**
 * Chronicle — HOSTILE AUDIT probes (judge-run, independent of team scripts).
 * Runs against a live server. Verifies claims by direct observation only.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const RESULTS = [];
function record(name, pass, detail = "") {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
}

async function req(method, path, { cookie, body, headers = {} } = {}) {
  const h = { "content-type": "application/json", ...headers };
  if (cookie) h.cookie = cookie;
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const ms = performance.now() - t0;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, text, data, ms, setCookie: res.headers.get("set-cookie") };
}

async function login(userId) {
  const r = await req("POST", "/api/session", { body: { userId } });
  if (r.status !== 200 || !r.setCookie) throw new Error(`login ${userId} failed: ${r.status}`);
  return r.setCookie.split(";")[0];
}

/* ---------------------------------------------------------- PROBE 2: AUTH */
// 2a. Unauthenticated must be 401.
const unauth = await req("GET", "/api/reconstruct");
record("P2a unauth GET /api/reconstruct -> 401", unauth.status === 401, `got ${unauth.status}`);

// 2b. Tier header spoof must be ignored (byte-identical to T1 baseline).
const jordan = await login("jordan");
const base = await req("GET", "/api/reconstruct", { cookie: jordan });
const spoof = await req("GET", "/api/reconstruct", {
  cookie: jordan,
  headers: { "x-viewer-tier": "3", "x-viewer-id": "alex" },
});
record(
  "P2b x-viewer-tier:3 header ignored (byte-identical to T1)",
  base.status === 200 && spoof.status === 200 && base.text === spoof.text,
  `status ${base.status}/${spoof.status} identical=${base.text === spoof.text} bytes=${base.text.length}`
);

// 2c. Secret redaction wire + export (login as Alex/T3).
const alex = await login("alex");

const SECRET_TOKENS = [
  "sk-live-TEST123",
  "ghp_TOKEN4567890123456",
  "AKIAIOSFODNN7EXAMPLE",
  "postgres://user:password@db.example.com:5432/prod",
  "alex.dev@protonmail.com",
];
const EXPECTED_SECRET_TYPES = [
  "OPENAI_STRIPE_KEY",
  "GITHUB_TOKEN",
  "AWS_ACCESS_KEY",
  "DATABASE_URL",
  "PRIVATE_EMAIL",
];
const SECRET_RAW = `We decided to migrate staging and rotate the deployment token ${SECRET_TOKENS.join(", ")} before handover.`;
const secretIngest = await req("POST", "/api/ingest", {
  cookie: alex,
  body: {
    title: "Hostile Audit Secret Source",
    sourceType: "JIRA_TICKET",
    author: "@audit_judge",
    rawText: `Plain text. ${SECRET_RAW}. More plain.`,
    accessTier: 3,
  },
});
record(
  "P2c ingest 5 secrets -> 200 with redactionCount=5",
  secretIngest.status === 200 && secretIngest.data?.scrub?.redactionCount === 5,
  `status ${secretIngest.status} redactionCount=${secretIngest.data?.scrub?.redactionCount} types=${JSON.stringify(
    secretIngest.data?.scrub?.matchedTypes
  )}`
);
// Reconstruct so the ingested source participates in claims + quotes.
await req("POST", "/api/reconstruct", { cookie: alex, body: {} });

const wire = await req("GET", "/api/reconstruct", { cookie: alex });
let leaked = SECRET_TOKENS.filter((t) => wire.text.includes(t));
record("P2c secret tokens ABSENT from GET /api/reconstruct wire", leaked.length === 0, `leaked=${JSON.stringify(leaked)}`);
record("P2c rawContent key stripped from wire DTO", !wire.text.includes('"rawContent"') && !wire.text.includes('rawContent'), `contains rawContent=${wire.text.includes("rawContent")}`);
record("P2c sanitizedContent served with [REDACTED_SECRET] placeholder", wire.text.includes("[REDACTED_SECRET]"), `placeholder=${wire.text.includes("[REDACTED_SECRET]")}`);

const exp = await req("GET", "/api/handover/export", { cookie: alex });
leaked = SECRET_TOKENS.filter((t) => exp.text.includes(t));
record("P2c secret tokens ABSENT from markdown export", leaked.length === 0, `leaked=${JSON.stringify(leaked)}`);

// Export only lists VERIFIED claims — run the full verify+lock path so the
// secret-bearing claim is eligible, then assert the placeholder exists.
await req("POST", "/api/reconstruct", { cookie: alex, body: { withVerify: true } });
// Server-side lock guard requires all conflicts resolved first.
await req("POST", "/api/handover", { cookie: alex, body: { action: "resolve_conflict", conflictId: "CT-001", choice: "SOURCE_A" } });
await req("POST", "/api/handover", { cookie: alex, body: { action: "resolve_conflict", conflictId: "CT-002", choice: "SOURCE_A" } });
await req("POST", "/api/handover", { cookie: alex, body: { action: "lock_snapshot" } });
const lockedExp = await req("GET", "/api/handover/export", { cookie: alex });
record(
  "P2c export shows redaction placeholder after verify+lock",
  lockedExp.status === 200 && lockedExp.text.includes("[REDACTED_SECRET]"),
  `status=${lockedExp.status} placeholder=${lockedExp.text.includes("[REDACTED_SECRET]")}`
);
const lockedLeak = SECRET_TOKENS.filter((t) => lockedExp.text.includes(t));
record("P2c locked export leaks 0 tokens", lockedLeak.length === 0, `leaked=${JSON.stringify(lockedLeak)}`);

/* ---------------------------------------------------------- PROBE 3: RBAC */
for (const [action, extra] of [
  ["lock_snapshot", {}],
  ["reset_demo", {}],
  ["resolve_conflict", { conflictId: "CT-001", choice: "SOURCE_A" }],
]) {
  const r = await req("POST", "/api/handover", { cookie: jordan, body: { action, ...extra } });
  record(`P3 Jordan ${action} -> 403 FORBIDDEN`, r.status === 403 && r.data?.error?.code === "FORBIDDEN", `got ${r.status} ${JSON.stringify(r.data?.error)}`);
}

/* ------------------------------------------------------ PROBE 4: RELIABILITY */
// Fresh reconstruct as Alex.
await req("POST", "/api/reconstruct", { cookie: alex, body: {} });
const before = await req("GET", "/api/handover", { cookie: alex });
const ctBefore = before.data?.conflicts?.find((c) => c.id === "CT-001");
record("P4a CT-001 conflict present pre-resolution", Boolean(ctBefore), `status=${ctBefore?.resolution}`);

const resolve = await req("POST", "/api/handover", {
  cookie: alex,
  body: { action: "resolve_conflict", conflictId: "CT-001", choice: "SOURCE_A", note: "hostile audit resolution" },
});
record("P4b Alex resolve CT-001 -> 200", resolve.status === 200 && resolve.data?.ok === true, `got ${resolve.status}`);

const after = await req("GET", "/api/handover", { cookie: alex });
const ctAfter = after.data?.conflicts?.find((c) => c.id === "CT-001");
record(
  "P4c CT-001 resolution persisted (SOURCE_A + resolvedAt)",
  ctAfter && ctAfter.resolution === "SOURCE_A" && Boolean(ctAfter.resolvedAt),
  `resolution=${ctAfter?.resolution} resolvedAt=${ctAfter?.resolvedAt}`
);

// Re-run reconstruction; resolution must NOT revert to UNRESOLVED.
await req("POST", "/api/reconstruct", { cookie: alex, body: {} });
const resurrect = await req("GET", "/api/handover", { cookie: alex });
const ctResurrect = resurrect.data?.conflicts?.find((c) => c.id === "CT-001");
record(
  "P4d CT-001 does NOT resurrect after reconstruct (stays resolved)",
  ctResurrect && ctResurrect.resolution !== "UNRESOLVED" && ctResurrect.resolution === "SOURCE_A",
  `resolution=${ctResurrect?.resolution} resolvedAt=${ctResurrect?.resolvedAt}`
);

// Timing: deterministic engine must be fast.
const timings = [];
for (let i = 0; i < 5; i++) {
  const t = await req("GET", "/api/reconstruct", { cookie: alex });
  timings.push(Math.round(t.ms));
}
const minMs = Math.min(...timings);
const avgMs = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
record("P4e GET /api/reconstruct mean < 1000ms (deterministic engine)", avgMs < 1000, `min=${minMs}ms mean=${avgMs}ms runs=[${timings}]`);

/* -------------------------------------------------------- PROBE 5: EDGE CASES */
// 5a. Empty ingest payload -> 4xx (no crash).
const emptyIngest = await req("POST", "/api/ingest", { cookie: alex, body: {} });
record("P5a empty ingest -> 4xx validation (no 5xx crash)", emptyIngest.status >= 400 && emptyIngest.status < 500, `got ${emptyIngest.status}`);

// 5b. Ingest with 0 secrets -> redactionCount 0.
const cleanIngest = await req("POST", "/api/ingest", {
  cookie: alex,
  body: {
    title: "Innocent Source",
    sourceType: "JIRA_TICKET",
    author: "@audit_judge",
    rawText: "A completely ordinary ticket body with no credential material whatsoever.",
    accessTier: 2,
  },
});
record(
  "P5b ingest 0 secrets -> redactionCount=0",
  cleanIngest.status === 200 && cleanIngest.data?.scrub?.redactionCount === 0,
  `got ${cleanIngest.status} redactionCount=${cleanIngest.data?.scrub?.redactionCount}`
);

// 5c. Ingest 10 secrets -> counts/types exact.
const TEN = Array.from({ length: 10 }, (_, i) =>
  i % 5 === 0 ? `sk-live-TOKEN0000${i}` : i % 5 === 1 ? `ghp_BBBBBBBBBBBBBBB${i}` : i % 5 === 2 ? `AKIA${String.fromCharCode(65 + i)}AAAAAAAAAAAAAAA` : i % 5 === 3 ? `postgres://u:p@h${i}.example.com:5432/db` : `person${i}@corp.example.com`
);
const tenIngest = await req("POST", "/api/ingest", {
  cookie: alex,
  body: {
    title: "Ten Secret Source",
    sourceType: "JIRA_TICKET",
    author: "@audit_judge",
    rawText: TEN.join("\n"),
    accessTier: 3,
  },
});
const types = tenIngest.data?.scrub?.matchedTypes ?? [];
record(
  "P5c ingest 10 secrets -> redactionCount=10, all 5 types",
  tenIngest.status === 200 &&
    tenIngest.data?.scrub?.redactionCount === 10 &&
    types.length === 5 &&
    EXPECTED_SECRET_TYPES.every((t) => types.includes(t)),
  `got ${tenIngest.status} count=${tenIngest.data?.scrub?.redactionCount} types=${JSON.stringify(types)}`
);
const wireTen = await req("GET", "/api/reconstruct", { cookie: alex });
const tenLeak = TEN.filter((t) => wireTen.text.includes(t));
record("P5c no secret token leaked in wire after 10-secret ingest", tenLeak.length === 0, `leaked=${JSON.stringify(tenLeak)}`);

/* ------------------------------------------------------------------ SUMMARY */
const failed = RESULTS.filter((r) => !r.pass);
console.log(`\n==== HOSTILE AUDIT: ${RESULTS.length - failed.length}/${RESULTS.length} probes passed ====`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
process.exit(0);
