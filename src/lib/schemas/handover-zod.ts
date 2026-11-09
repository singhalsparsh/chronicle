/**
 * Chronicle — Zod runtime validation schemas.
 * Validates every ingested artifact, claim, citation, conflict payload and API request/response.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enums                                                                */
/* ------------------------------------------------------------------ */

export const SourceTypeSchema = z.enum(["GITHUB_PR", "SLACK_THREAD", "JIRA_TICKET", "NOTION_DOC"]);
export type SourceTypeInput = z.infer<typeof SourceTypeSchema>;

export const AccessTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type AccessTierInput = z.infer<typeof AccessTierSchema>;

export const EvidenceCategorySchema = z.enum([
  "DECISION",
  "UNFINISHED",
  "RISK",
  "DEPENDENCY",
  "CONTACT",
  "NEXT_ACTION",
]);

export const ClaimStatusSchema = z.enum([
  "EVIDENCE_GATHERED",
  "VERIFIED",
  "MISSING_EVIDENCE",
  "HUMAN_APPROVED",
]);

export const CitationVerificationSchema = z.enum(["VERIFIED", "UNVERIFIED"]);

export const ConflictResolutionSchema = z.enum(["UNRESOLVED", "SOURCE_A", "SOURCE_B", "MANUAL_EDIT"]);

export const AuditActionSchema = z.enum([
  "APP_LOADED",
  "ROLE_CHANGED",
  "SOURCE_INGESTED",
  "SECRET_REDACTED",
  "RECONSTRUCT_COMPLETED",
  "VERIFICATION_COMPLETED",
  "CLAIM_EDITED",
  "CONFLICT_RESOLVED",
  "INTERVIEW_COMPLETED",
  "SNAPSHOT_LOCKED",
  "RECEIPT_ACKNOWLEDGED",
  "DEMO_RESET",
  "MUTATION_REJECTED",
]);

/* ------------------------------------------------------------------ */
/* Core entity schemas                                                  */
/* ------------------------------------------------------------------ */

export const SourceMetadataSchema = z
  .object({
    status: z.string().optional(),
    labels: z.array(z.string()).optional(),
    url: z.string().url().optional(),
    redactions: z
      .object({
        count: z.number().int().nonnegative(),
        types: z.array(z.string()),
      })
      .optional(),
  })
  .optional();

export const SourceFactSchema = z.object({
  category: EvidenceCategorySchema,
  title: z.string().min(3),
  summary: z.string().min(8),
  verbatimQuote: z.string().min(8),
  conflictGroup: z.string().optional(),
  stance: z.string().optional(),
  gapId: z.string().optional(),
  suggests: z.string().optional(),
  candidate: z.boolean().optional(),
});

export const SourceArtifactSchema = z.object({
  id: z
    .string()
    .min(3)
    .regex(/^[A-Z0-9][A-Z0-9-]{2,}$/),
  type: SourceTypeSchema,
  title: z.string().min(3),
  author: z.string().refine((a) => a.startsWith("@"), { message: "author must start with @" }),
  createdAt: z.string().datetime({ offset: true }),
  accessTier: AccessTierSchema,
  rawContent: z.string().min(10),
  sanitizedContent: z.string().min(10),
  metadata: SourceMetadataSchema,
  facts: z.array(SourceFactSchema).default([]),
});

export const CitationSchema = z.object({
  sourceId: z.string().min(3),
  verbatimQuote: z.string().min(5),
  accessTier: AccessTierSchema,
  verification: CitationVerificationSchema,
});

export const ClaimSchema = z.object({
  id: z.string().min(3),
  category: EvidenceCategorySchema,
  title: z.string().min(3),
  summary: z.string().min(5),
  timestamp: z.string().datetime({ offset: true }),
  author: z.string(),
  accessTier: AccessTierSchema,
  status: ClaimStatusSchema,
  citations: z.array(CitationSchema).min(1),
  conflictGroup: z.string().optional(),
  stance: z.string().optional(),
  gapId: z.string().optional(),
  superseded: z.boolean().optional(),
});

export const ConflictSideSchema = z.object({
  sourceId: z.string(),
  claimId: z.string(),
  value: z.string(),
  quote: z.string(),
});

export const ConflictCandidateSchema = z.object({
  id: z.string().min(2),
  subject: z.string().min(3),
  sourceA: ConflictSideSchema,
  sourceB: ConflictSideSchema,
  corroboratingB: z.array(z.string()).default([]),
  recommendation: z.enum(["SOURCE_A", "SOURCE_B", "MANUAL"]),
  resolution: ConflictResolutionSchema,
  manualNote: z.string().optional(),
  resolvedAt: z.string().optional(),
});

export const MissingEvidenceItemSchema = z.object({
  id: z.string().min(2),
  title: z.string().min(3),
  description: z.string().min(5),
  sourceIds: z.array(z.string()).min(1),
  questions: z.array(z.string()).min(3).max(3),
  suggestedAnswers: z.array(z.string()).default([]),
  answers: z.array(z.string().nullable()).default([]),
  status: z.enum(["MISSING_EVIDENCE", "HUMAN_APPROVED"]),
  approvedAt: z.string().optional(),
});

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  ts: z.string().datetime({ offset: true }),
  actor: z.string(),
  action: AuditActionSchema,
  detail: z.string(),
});

export const HandoverSnapshotSchema = z.object({
  version: z.string().min(1),
  locked: z.boolean(),
  lockedAt: z.string().optional(),
  receiptAcknowledged: z.boolean(),
  receiptAcknowledgedAt: z.string().optional(),
  ackActor: z.string().optional(),
  digest: z.string(),
});

export const NextActionItemSchema = z.object({
  task: z.string().min(3),
  ownerHint: z.string().optional(),
  priority: z.enum(["P0", "P1", "P2"]),
  ref: z.string(),
});

export const WhoToAskEntrySchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1),
  artifactCount: z.number().int().nonnegative(),
  factCount: z.number().int().nonnegative(),
  topics: z.array(z.string()),
});

export const WorkspaceStatsSchema = z.object({
  totalSources: z.number().int().nonnegative(),
  visibleSources: z.number().int().nonnegative(),
  withheldSources: z.number().int().nonnegative(),
  totalClaims: z.number().int().nonnegative(),
  visibleClaims: z.number().int().nonnegative(),
  withheldClaims: z.number().int().nonnegative(),
  verifiedClaims: z.number().int().nonnegative(),
  missingEvidenceClaims: z.number().int().nonnegative(),
  humanApprovedClaims: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  unresolvedConflicts: z.number().int().nonnegative(),
  openGaps: z.number().int().nonnegative(),
  totalRedactions: z.number().int().nonnegative(),
  auditEntries: z.number().int().nonnegative(),
});

export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  departingLead: z.string().min(1),
  reason: z.string().min(1),
  lastReconstructedAt: z.string().optional(),
});

export const WorkspaceStateSchema = z.object({
  mode: z.enum(["memory", "supabase"]),
  persistenceError: z.string().optional(),
  project: ProjectMetaSchema,
  sources: z.array(SourceArtifactSchema),
  claims: z.array(ClaimSchema),
  conflicts: z.array(ConflictCandidateSchema),
  gaps: z.array(MissingEvidenceItemSchema),
  nextActions: z.array(NextActionItemSchema),
  whoToAsk: z.array(WhoToAskEntrySchema),
  handover: HandoverSnapshotSchema,
  auditLog: z.array(AuditLogEntrySchema),
  stats: WorkspaceStatsSchema,
});

export const PersistedStateSchema = z.object({
  project: ProjectMetaSchema,
  sources: z.array(SourceArtifactSchema),
  factsBySource: z.record(z.string(), z.array(SourceFactSchema)),
  claims: z.array(ClaimSchema),
  conflicts: z.array(ConflictCandidateSchema),
  gaps: z.array(MissingEvidenceItemSchema),
  nextActions: z.array(NextActionItemSchema),
  whoToAsk: z.array(WhoToAskEntrySchema),
  handover: HandoverSnapshotSchema,
  auditLog: z.array(AuditLogEntrySchema),
});

/* ------------------------------------------------------------------ */
/* API payload schemas                                                  */
/* ------------------------------------------------------------------ */

export const IngestRequestSchema = z.object({
  title: z.string().min(3).max(120),
  sourceType: SourceTypeSchema,
  author: z.string().refine((a) => a.startsWith("@"), { message: "author must start with @" }),
  rawText: z.string().min(10).max(20000),
  accessTier: AccessTierSchema.optional(),
  url: z.string().url().optional(),
});

export const ReconstructRequestSchema = z.object({
  withVerify: z.boolean().optional(),
});

export const VerifyRequestSchema = z.object({
  claimIds: z.array(z.string()).optional(),
});

export const ResolveConflictSchema = z.object({
  conflictId: z.string().min(2),
  choice: z.enum(["SOURCE_A", "SOURCE_B", "MANUAL_EDIT"]),
  note: z.string().max(2000).optional(),
});

export const SubmitInterviewSchema = z.object({
  gapId: z.string().min(2),
  answers: z.array(z.string()).min(3).max(3),
});

export const EditClaimSchema = z.object({
  claimId: z.string().min(3),
  summary: z.string().min(5).max(2000),
});

export const HandoverRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve_conflict"), ...ResolveConflictSchema.shape }),
  z.object({ action: z.literal("submit_interview"), ...SubmitInterviewSchema.shape }),
  z.object({ action: z.literal("edit_claim"), ...EditClaimSchema.shape }),
  z.object({ action: z.literal("lock_snapshot") }),
  z.object({ action: z.literal("acknowledge_receipt") }),
  z.object({ action: z.literal("reset_demo") }),
]);

export const ViewerTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** Deterministic API error envelope that every route returns. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type WorkspaceStateType = z.infer<typeof WorkspaceStateSchema>;
export type PersistedStateType = z.infer<typeof PersistedStateSchema>;
export type IngestRequest = z.infer<typeof IngestRequestSchema>;
export type HandoverRequest = z.infer<typeof HandoverRequestSchema>;
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type ReconstructRequest = z.infer<typeof ReconstructRequestSchema>;
