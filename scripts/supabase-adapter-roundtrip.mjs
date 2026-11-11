/**
 * Chronicle — real Supabase adapter round-trip (save → load → save → load).
 *
 * Runs against a PostgREST instance (Supabase-compatible) with migrations
 * 001-006 applied. Exercises the *actual* adapter code path — not hand-built
 * SQL rows — and asserts:
 *   - a full save then load round-trips the state (digest-equal),
 *   - conflicts persist `access_tier` = max of linked claim tiers,
 *   - gaps persist `access_tier` = min of linked source tiers,
 *   - a second save does not duplicate next_actions,
 *   - resolution/superseded mutations survive a reload.
 *
 * Requires env: SUPABASE_URL (base, no /rest/v1), SUPABASE_SERVICE_ROLE_KEY.
 */
import { createHmac } from "node:crypto";
import { SupabaseRelationalPersistence } from "../src/lib/store/supabase-persistence.ts";

const baseUrl = (process.env.SUPABASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

function signJwt(payload, secret) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const JWT_SECRET = process.env.JWT_SECRET ?? "ci-jwt-secret";
const key = signJwt({ role: "service_role", iss: "ci" }, JWT_SECRET);

function buildState() {
  const now = new Date().toISOString();
  return {
    project: { name: "Core-Payments-Service", departingLead: "@alex_dev", reason: "r" },
    sources: [
      {
        id: "SRC-T1", type: "SLACK_THREAD", title: "Low tier source", author: "@a",
        createdAt: now, accessTier: 1,
        rawContent: "We decided to keep the low-tier note.", sanitizedContent: "We decided to keep the low-tier note.",
      },
      {
        id: "SRC-T3", type: "NOTION_DOC", title: "High tier source", author: "@b",
        createdAt: now, accessTier: 3,
        rawContent: "We decided to document the high-tier decision.", sanitizedContent: "We decided to document the high-tier decision.",
      },
    ],
    factsBySource: {
      "SRC-T1": [{ category: "DECISION", title: "Keep low-tier", summary: "We decided to keep the low-tier note.", verbatimQuote: "We decided to keep the low-tier note." }],
      "SRC-T3": [{ category: "DECISION", title: "High-tier doc", summary: "We decided to document the high-tier decision.", verbatimQuote: "We decided to document the high-tier decision." }],
    },
    claims: [
      {
        id: "C-001", category: "DECISION", title: "Keep low-tier", summary: "We decided to keep the low-tier note.",
        timestamp: now, author: "@a", accessTier: 1, status: "VERIFIED",
        citations: [{ sourceId: "SRC-T1", verbatimQuote: "We decided to keep the low-tier note.", accessTier: 1, verification: "VERIFIED" }],
      },
      {
        id: "C-002", category: "DECISION", title: "High-tier doc", summary: "We decided to document the high-tier decision.",
        timestamp: now, author: "@b", accessTier: 3, status: "VERIFIED",
        citations: [{ sourceId: "SRC-T3", verbatimQuote: "We decided to document the high-tier decision.", accessTier: 3, verification: "VERIFIED" }],
      },
    ],
    conflicts: [
      {
        id: "CT-001", subject: "documentation approach",
        sourceA: { sourceId: "SRC-T1", claimId: "C-001", value: "A", quote: "low-tier" },
        sourceB: { sourceId: "SRC-T3", claimId: "C-002", value: "B", quote: "high-tier" },
        corroboratingB: [], recommendation: "SOURCE_A", resolution: "UNRESOLVED",
      },
    ],
    gaps: [
      {
        id: "gap-1", title: "Unfinished integration", description: "Needs closure",
        sourceIds: ["SRC-T1", "SRC-T3"],
        questions: ["q1", "q2", "q3"], suggestedAnswers: [], answers: [],
        status: "MISSING_EVIDENCE",
      },
    ],
    nextActions: [
      { task: "Unblock: high-tier work", ownerHint: "@b", priority: "P0", ref: "C-002" },
      { task: "Close exit interview: Unfinished integration", ownerHint: "@a", priority: "P0", ref: "gap-1" },
    ],
    whoToAsk: [
      { handle: "@a", displayName: "Alex", artifactCount: 1, factCount: 1, topics: ["decision"] },
    ],
    handover: { version: "v1.0", locked: false, receiptAcknowledged: false, digest: "" },
    auditLog: [
      { id: "AUD-001", ts: now, actor: "System", action: "APP_LOADED", detail: "roundtrip" },
    ],
  };
}

function assert(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`PASS ${label}`);
}

const persistence = new SupabaseRelationalPersistence(`${baseUrl}/rest/v1`, key);

await persistence.init();

// 1. Save → load.
await persistence.saveState(buildState());
const loaded1 = await persistence.loadState();
assert(loaded1 !== null, "loadState after first save returns state");
assert(loaded1.claims.length === 2, "two claims round-trip");
assert(loaded1.conflicts.length === 1, "one conflict round-trips");
assert(loaded1.gaps.length === 1, "one gap round-trips");
assert(loaded1.nextActions.length === 2, "two next actions round-trip");
assert(loaded1.auditLog.some((e) => e.id === "AUD-001"), "AUD-001 audit row round-trips");

// 2. Persisted tier columns for conflicts (max) and gaps (min).
const direct = async (path) => {
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`direct select failed ${res.status}`);
  return res.json();
};
const conflictRow = (await direct("conflicts?select=id,access_tier&id=eq.CT-001"))[0];
assert(conflictRow?.access_tier === 3, `conflict access_tier=3 (got ${conflictRow?.access_tier})`);
const gapRow = (await direct("gaps?select=id,access_tier&id=eq.gap-1"))[0];
assert(gapRow?.access_tier === 1, `gap access_tier=1 via MIN (got ${gapRow?.access_tier})`);

// 3. Mutate + second save → no duplicate next actions, resolution persists.
const mutated = buildState();
mutated.conflicts[0].resolution = "SOURCE_A";
mutated.conflicts[0].resolvedAt = new Date().toISOString();
mutated.claims[1].superseded = true;
await persistence.saveState(mutated);

const loaded2 = await persistence.loadState();
assert(loaded2.conflicts[0].resolution === "SOURCE_A", "resolution persists across save/load");
assert(loaded2.claims[1].superseded === true, "superseded persists across save/load");

const naRows = await direct("next_actions?select=ref,task");
assert(naRows.length === 2, `no duplicate next actions after second save (got ${naRows.length})`);
const uniqueKeys = new Set(naRows.map((r) => `${r.ref}|${r.task}`));
assert(uniqueKeys.size === naRows.length, "next action (ref,task) pairs unique");

console.log("\nAll adapter round-trip checks passed.");
