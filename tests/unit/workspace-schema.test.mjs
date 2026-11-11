import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStateSchema } from "../../src/lib/schemas/handover-zod.ts";

const baseState = {
  mode: "memory",
  project: { name: "P", departingLead: "@a", reason: "r" },
  sources: [],
  claims: [],
  conflicts: [],
  gaps: [],
  nextActions: [],
  whoToAsk: [],
  handover: { version: "v1.0", locked: false, receiptAcknowledged: false, digest: "" },
  auditLog: [],
  stats: {
    totalSources: 0, visibleSources: 0, withheldSources: 0,
    totalClaims: 0, visibleClaims: 0, withheldClaims: 0,
    verifiedClaims: 0, missingEvidenceClaims: 0, humanApprovedClaims: 0,
    supersededClaims: 0,
    conflicts: 0, unresolvedConflicts: 0, openGaps: 0,
    totalRedactions: 0, auditEntries: 0,
  },
};

test("WorkspaceStateSchema accepts supersededClaims stat", () => {
  const parsed = WorkspaceStateSchema.safeParse(baseState);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("WorkspaceStateSchema rejects state missing supersededClaims", () => {
  const without = { ...baseState.stats };
  delete without.supersededClaims;
  const parsed = WorkspaceStateSchema.safeParse({ ...baseState, stats: without });
  assert.equal(parsed.success, false);
});
