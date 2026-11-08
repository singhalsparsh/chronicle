/**
 * Chronicle — Programmatic Citation Quote Verifier.
 *
 * 1. Checks that every citation.source_id exists in the source map.
 * 2. Checks that citation.verbatim_quote (normalized for whitespace/case) is an
 *    actual substring of the source's content.
 * 3. If a claim lacks a valid substring match and is not HUMAN_APPROVED, it is
 *    automatically downgraded to MISSING_EVIDENCE.
 */
import type { Claim, SourceArtifact } from "@/lib/types";

export function normalizeEvidenceText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface VerificationOutcome {
  ok: boolean;
  checked: number;
  anyUnverified: boolean;
  downgrade: boolean;
}

export function verifyClaimCitations(
  claim: Claim,
  sourceMap: Map<string, SourceArtifact>
): VerificationOutcome {
  let ok = true;
  let downgrade = false;

  for (const citation of claim.citations) {
    const source = sourceMap.get(citation.sourceId);
    const exists = Boolean(source);
    const normalizedQuote = normalizeEvidenceText(citation.verbatimQuote);
    const isSubstring =
      exists &&
      normalizedQuote.length > 0 &&
      normalizeEvidenceText(source!.sanitizedContent).includes(normalizedQuote);

    citation.verification = exists && isSubstring ? "VERIFIED" : "UNVERIFIED";
    if (!exists || !isSubstring) ok = false;
  }

  if (!ok) {
    if (claim.status !== "HUMAN_APPROVED") {
      claim.status = "MISSING_EVIDENCE";
      downgrade = true;
    }
  } else if (claim.status === "EVIDENCE_GATHERED") {
    // All citations resolve to verbatim substrings → claim is now verified.
    // Gap-linked claims stay MISSING_EVIDENCE until the human exit interview.
    claim.status = "VERIFIED";
  }

  return { ok, checked: claim.citations.length, anyUnverified: !ok, downgrade };
}

/**
 * Assigns citation verification flags without mutating claim status.
 * Used at reconstruction time so quote grounding stats are visible before the
 * explicit /api/verify run downgrades unverifiable claims.
 */
export function preflightCitations(claims: Claim[], sources: SourceArtifact[]): void {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  for (const claim of claims) {
    for (const citation of claim.citations) {
      const source = sourceMap.get(citation.sourceId);
      const exists = Boolean(source);
      const isSubstring =
        exists &&
        normalizeEvidenceText(citation.verbatimQuote).length > 0 &&
        normalizeEvidenceText(source!.sanitizedContent).includes(normalizeEvidenceText(citation.verbatimQuote));
      citation.verification = exists && isSubstring ? "VERIFIED" : "UNVERIFIED";
    }
  }
}

export function verifyClaims(
  claims: Claim[],
  sources: SourceArtifact[]
): { claims: Claim[]; verified: number; downgraded: number } {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  let verified = 0;
  let downgraded = 0;

  for (const claim of claims) {
    const outcome = verifyClaimCitations(claim, sourceMap);
    if (outcome.ok) verified += 1;
    if (outcome.downgrade) downgraded += 1;
  }

  return { claims, verified, downgraded };
}
