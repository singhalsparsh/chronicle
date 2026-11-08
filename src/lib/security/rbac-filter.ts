/**
 * Chronicle — Deterministic RBAC clearance filter.
 *
 * Clearance hierarchy (viewer tier must be >= artifact/claim tier):
 *   TIER_1_RESTRICTED  = 1  (External Contractor — Jordan)
 *   TIER_2_INTERNAL    = 2  (Internal Engineer — Sam)
 *   TIER_3_CONFIDENTIAL= 3  (Maintainer / Admin — Priya)
 */
import type { AccessTier, Citation, Claim, SourceArtifact } from "@/lib/types";

export function canViewTier(viewerTier: AccessTier, artifactTier: AccessTier): boolean {
  return artifactTier <= viewerTier;
}

export interface SourceFilterResult {
  visibleSources: SourceArtifact[];
  withheldSourceCount: number;
  withheldSourceIds: string[];
}

/** Filters sources BEFORE reconstruction/rendering. */
export function filterSourcesByClearance(
  sources: SourceArtifact[],
  viewerTier: AccessTier
): SourceFilterResult {
  const visible: SourceArtifact[] = [];
  const withheld: string[] = [];
  for (const source of sources) {
    if (canViewTier(viewerTier, source.accessTier)) {
      visible.push(source);
    } else {
      withheld.push(source.id);
    }
  }
  return { visibleSources: visible, withheldSourceCount: withheld.length, withheldSourceIds: withheld };
}

/** Claim access tier = max over its citations' source tiers. Empty citations default to tier 1. */
export function computeClaimAccessTier(citations: Citation[]): AccessTier {
  if (citations.length === 0) return 1;
  const maxTier = citations.reduce((max, c) => Math.max(max, c.accessTier), 1);
  return maxTier as AccessTier;
}

export interface ClaimFilterResult {
  visibleClaims: Claim[];
  withheldClaimCount: number;
  withheldClaimIds: string[];
}

/** Strips any claim whose computed access tier exceeds the viewer tier. */
export function filterClaimsByClearance(claims: Claim[], viewerTier: AccessTier): ClaimFilterResult {
  const visible: Claim[] = [];
  const withheld: string[] = [];
  for (const claim of claims) {
    if (canViewTier(viewerTier, claim.accessTier)) {
      visible.push(claim);
    } else {
      withheld.push(claim.id);
    }
  }
  return { visibleClaims: visible, withheldClaimCount: withheld.length, withheldClaimIds: withheld };
}
