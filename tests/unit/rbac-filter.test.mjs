import test from "node:test";
import assert from "node:assert/strict";
import {
  canViewTier,
  computeClaimAccessTier,
  filterClaimsByClearance,
  filterSourcesByClearance,
} from "../../src/lib/security/rbac-filter.ts";

test("tier hierarchy: viewer must be >= artifact tier", () => {
  assert.equal(canViewTier(1, 1), true);
  assert.equal(canViewTier(1, 2), false);
  assert.equal(canViewTier(2, 2), true);
  assert.equal(canViewTier(2, 3), false);
  assert.equal(canViewTier(3, 3), true);
});

test("claim access tier is the max over citation source tiers", () => {
  assert.equal(computeClaimAccessTier([{ accessTier: 1 }, { accessTier: 2 }]), 2);
  assert.equal(computeClaimAccessTier([{ accessTier: 3 }, { accessTier: 1 }]), 3);
});

test("claims with no citations default to tier 1", () => {
  assert.equal(computeClaimAccessTier([]), 1);
});

test("filterSourcesByClearance hides over-tier sources", () => {
  const sources = [
    { id: "S1", accessTier: 1 },
    { id: "S2", accessTier: 2 },
    { id: "S3", accessTier: 3 },
  ];
  const result = filterSourcesByClearance(sources, 2);
  assert.deepEqual(result.visibleSources.map((s) => s.id), ["S1", "S2"]);
  assert.equal(result.withheldSourceCount, 1);
  assert.deepEqual(result.withheldSourceIds, ["S3"]);
});

test("filterClaimsByClearance hides over-tier claims", () => {
  const claims = [
    { id: "C1", accessTier: 1 },
    { id: "C2", accessTier: 3 },
  ];
  const result = filterClaimsByClearance(claims, 1);
  assert.deepEqual(result.visibleClaims.map((c) => c.id), ["C1"]);
  assert.deepEqual(result.withheldClaimIds, ["C2"]);
});
