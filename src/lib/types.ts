/**
 * Chronicle — shared domain types.
 * Evidence-Linked Project State Reconstruction & Permissioned Handover System.
 */

export const TIER_VALUES = {
  TIER_1_RESTRICTED: 1,
  TIER_2_INTERNAL: 2,
  TIER_3_CONFIDENTIAL: 3,
} as const;

export type TierKey = keyof typeof TIER_VALUES;
export type AccessTier = (typeof TIER_VALUES)[TierKey];

export const TIER_KEYS: Record<AccessTier, TierKey> = {
  1: "TIER_1_RESTRICTED",
  2: "TIER_2_INTERNAL",
  3: "TIER_3_CONFIDENTIAL",
};

export function tierKey(tier: AccessTier): TierKey {
  return TIER_KEYS[tier];
}

export type SourceType =
  | "GITHUB_PR"
  | "SLACK_THREAD"
  | "JIRA_TICKET"
  | "NOTION_DOC";

export interface SourceMetadata {
  status?: string;
  labels?: string[];
  url?: string;
  /** Scrub summary captured at write time; the stored rawContent is already scrubbed. */
  redactions?: { count: number; types: string[] };
}

export interface SourceArtifact {
  id: string;
  type: SourceType;
  title: string;
  author: string;
  createdAt: string; // ISO 8601
  accessTier: AccessTier;
  rawContent: string;
  sanitizedContent: string;
  metadata?: SourceMetadata;
}

/** Structured extraction hint embedded in a source artifact (ground truth for the deterministic engine). */
export interface SourceFact {
  category: EvidenceCategory;
  title: string;
  summary: string;
  verbatimQuote: string;
  conflictGroup?: string;
  stance?: string;
  gapId?: string;
  suggests?: string;
  /** True when the fact was extracted heuristically from raw text, not authored in the seed. */
  candidate?: boolean;
}

export type EvidenceCategory =
  | "DECISION"
  | "UNFINISHED"
  | "RISK"
  | "DEPENDENCY"
  | "CONTACT"
  | "NEXT_ACTION";

export type CitationVerification = "VERIFIED" | "UNVERIFIED";

export interface Citation {
  sourceId: string;
  verbatimQuote: string;
  accessTier: AccessTier;
  verification: CitationVerification;
}

export type ClaimStatus =
  | "EVIDENCE_GATHERED"
  | "VERIFIED"
  | "MISSING_EVIDENCE"
  | "HUMAN_APPROVED";

export interface Claim {
  id: string;
  category: EvidenceCategory;
  title: string;
  summary: string;
  timestamp: string; // ISO
  author: string;
  accessTier: AccessTier;
  status: ClaimStatus;
  citations: Citation[];
  conflictGroup?: string;
  stance?: string;
  gapId?: string;
  /** True when this claim was superseded by a resolved conflict (kept for history). */
  superseded?: boolean;
}

export type ConflictResolution = "UNRESOLVED" | "SOURCE_A" | "SOURCE_B" | "MANUAL_EDIT";

export interface ConflictSide {
  sourceId: string;
  claimId: string;
  value: string;
  quote: string;
}

export interface ConflictCandidate {
  id: string;
  subject: string;
  sourceA: ConflictSide;
  sourceB: ConflictSide;
  corroboratingB: string[]; // source ids that agree with source B
  recommendation: "SOURCE_A" | "SOURCE_B" | "MANUAL";
  resolution: ConflictResolution;
  manualNote?: string;
  resolvedAt?: string;
}

export type GapStatus = "MISSING_EVIDENCE" | "HUMAN_APPROVED";

export interface MissingEvidenceItem {
  id: string;
  title: string;
  description: string;
  sourceIds: string[];
  questions: string[];
  suggestedAnswers: string[];
  answers: (string | null)[];
  status: GapStatus;
  approvedAt?: string;
}

export type AuditAction =
  | "APP_LOADED"
  | "ROLE_CHANGED"
  | "SOURCE_INGESTED"
  | "SECRET_REDACTED"
  | "RECONSTRUCT_COMPLETED"
  | "VERIFICATION_COMPLETED"
  | "CLAIM_EDITED"
  | "CONFLICT_RESOLVED"
  | "INTERVIEW_COMPLETED"
  | "SNAPSHOT_LOCKED"
  | "RECEIPT_ACKNOWLEDGED"
  | "DEMO_RESET";

export interface AuditLogEntry {
  id: string;
  ts: string;
  actor: string;
  action: AuditAction;
  detail: string;
}

export interface HandoverSnapshot {
  version: string;
  locked: boolean;
  lockedAt?: string;
  receiptAcknowledged: boolean;
  receiptAcknowledgedAt?: string;
  ackActor?: string;
  digest: string;
}

export interface NextActionItem {
  task: string;
  ownerHint?: string;
  priority: "P0" | "P1" | "P2";
  ref: string;
}

export interface WhoToAskEntry {
  handle: string;
  displayName: string;
  artifactCount: number;
  factCount: number;
  topics: string[];
}

export interface WorkspaceStats {
  totalSources: number;
  visibleSources: number;
  withheldSources: number;
  totalClaims: number;
  visibleClaims: number;
  withheldClaims: number;
  verifiedClaims: number;
  missingEvidenceClaims: number;
  humanApprovedClaims: number;
  conflicts: number;
  unresolvedConflicts: number;
  openGaps: number;
  totalRedactions: number;
  auditEntries: number;
}

export interface ProjectMeta {
  name: string;
  departingLead: string;
  reason: string;
  lastReconstructedAt?: string;
}

export type PersistenceMode = "memory" | "supabase";

export interface WorkspaceState {
  mode: PersistenceMode;
  persistenceError?: string;
  project: ProjectMeta;
  sources: SourceArtifact[];
  claims: Claim[];
  conflicts: ConflictCandidate[];
  gaps: MissingEvidenceItem[];
  nextActions: NextActionItem[];
  whoToAsk: WhoToAskEntry[];
  handover: HandoverSnapshot;
  auditLog: AuditLogEntry[];
  stats: WorkspaceStats;
}

export interface PersistedState {
  project: ProjectMeta;
  sources: SourceArtifact[];
  factsBySource: Record<string, SourceFact[]>;
  claims: Claim[];
  conflicts: ConflictCandidate[];
  gaps: MissingEvidenceItem[];
  nextActions: NextActionItem[];
  whoToAsk: WhoToAskEntry[];
  handover: HandoverSnapshot;
  auditLog: AuditLogEntry[];
}

export type ViewerRole =
  | "t1-contractor"
  | "t2-engineer"
  | "t3-maintainer";

export const VIEWER_ROLES: Record<ViewerRole, { tier: AccessTier; label: string; actor: string; description: string }> = {
  "t1-contractor": {
    tier: 1,
    label: "T1 · External Contractor",
    actor: "Jordan (External Contractor)",
    description: "Jordan, external contractor, restricted to TIER_1 artifacts.",
  },
  "t2-engineer": {
    tier: 2,
    label: "T2 · Internal Engineer",
    actor: "Sam (Internal Engineer)",
    description: "Sam, internal engineer; sees TIER_1 + TIER_2 artifacts.",
  },
  "t3-maintainer": {
    tier: 3,
    label: "T3 · Maintainer / Admin",
    actor: "Priya (Maintainer / Admin)",
    description: "Priya, maintainer; sees all tiers including TIER_3 confidential.",
  },
};

export const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  DECISION: "Decisions",
  UNFINISHED: "Unfinished Work",
  RISK: "Risks / Blockers",
  DEPENDENCY: "Dependencies",
  CONTACT: "Who-to-Ask",
  NEXT_ACTION: "Next Actions",
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  GITHUB_PR: "GitHub PR",
  SLACK_THREAD: "Slack Thread",
  JIRA_TICKET: "Jira Ticket",
  NOTION_DOC: "Notion Doc",
};

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  EVIDENCE_GATHERED: "Evidence gathered",
  VERIFIED: "Verified",
  MISSING_EVIDENCE: "Missing evidence",
  HUMAN_APPROVED: "Human approved",
};
