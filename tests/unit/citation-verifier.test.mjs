import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEvidenceText,
  verifyClaimCitations,
  preflightCitations,
} from "../../src/lib/engine/citation-verifier.ts";

const sources = new Map([
  [
    "SRC-01",
    {
      id: "SRC-01",
      sanitizedContent: "We decided to migrate staging to SQS with zero downtime.",
    },
  ],
]);

function makeClaim(overrides = {}) {
  return {
    id: "C-001",
    status: "EVIDENCE_GATHERED",
    citations: [
      { sourceId: "SRC-01", verbatimQuote: "decided to migrate staging", verification: "UNVERIFIED" },
    ],
    ...overrides,
  };
}

test("normalizeEvidenceText collapses whitespace and case", () => {
  assert.equal(normalizeEvidenceText("  We Decided\n to  MIGRATE "), "we decided to migrate");
});

test("verbatim substring marks citation verified and upgrades to VERIFIED", () => {
  const claim = makeClaim();
  const out = verifyClaimCitations(claim, sources);
  assert.equal(out.ok, true);
  assert.equal(claim.citations[0].verification, "VERIFIED");
  assert.equal(claim.status, "VERIFIED");
});

test("missing source downgrades to MISSING_EVIDENCE", () => {
  const claim = makeClaim({ citations: [{ sourceId: "NOPE", verbatimQuote: "anything", verification: "UNVERIFIED" }] });
  const out = verifyClaimCitations(claim, sources);
  assert.equal(out.ok, false);
  assert.equal(out.downgrade, true);
  assert.equal(claim.status, "MISSING_EVIDENCE");
});

test("non-substring quote downgrades to MISSING_EVIDENCE", () => {
  const claim = makeClaim({ citations: [{ sourceId: "SRC-01", verbatimQuote: "totally different text", verification: "UNVERIFIED" }] });
  const out = verifyClaimCitations(claim, sources);
  assert.equal(out.ok, false);
  assert.equal(claim.status, "MISSING_EVIDENCE");
});

test("HUMAN_APPROVED claims are never downgraded", () => {
  const claim = makeClaim({ status: "HUMAN_APPROVED", citations: [{ sourceId: "NOPE", verbatimQuote: "x", verification: "UNVERIFIED" }] });
  const out = verifyClaimCitations(claim, sources);
  assert.equal(out.downgrade, false);
  assert.equal(claim.status, "HUMAN_APPROVED");
});

test("preflightCitations assigns flags without mutating claim status", () => {
  const claims = [makeClaim()];
  preflightCitations(claims, [sources.get("SRC-01")]);
  assert.equal(claims[0].citations[0].verification, "VERIFIED");
  assert.equal(claims[0].status, "EVIDENCE_GATHERED");
});
