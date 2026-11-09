/**
 * Chronicle — Hybrid persistence layer.
 *
 * Uses Supabase relational persistence (per-entity tables + RLS) when
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are configured; otherwise
 * falls back to a pre-seeded stateful in-memory store so the deployed demo works
 * with zero configuration friction.
 *
 * Security notes (audit remediation):
 *  - Clearance filtering happens BEFORE any source text reaches an LLM prompt.
 *  - Conflict resolution is transactional: the losing claim is demoted in the
 *    same mutation that records the resolution.
 *  - Integrity digests are SHA-256 over a canonical projection.
 *  - Custom sources get candidate facts via a deterministic extractor, so
 *    ingestion never silently yields "no facts" when the LLM path is off.
 */
import { createHash } from "node:crypto";
import { SourceArtifactSchema } from "@/lib/schemas/handover-zod";
import { scrubSecrets } from "@/lib/security/secret-scrubber";
import { computeClaimAccessTier, filterClaimsByClearance, filterSourcesByClearance } from "@/lib/security/rbac-filter";
import { verifyClaims } from "@/lib/engine/citation-verifier";
import { heuristicReconstruct, reconstructState, type GapDefinition, type ReconstructionResult } from "@/lib/engine/temporal-reconstructor";
import { extractCandidateFacts } from "@/lib/engine/heuristic-extractor";
import { SupabaseRelationalPersistence } from "@/lib/store/supabase-persistence";
import type {
  AccessTier,
  AuditAction,
  AuditLogEntry,
  ConflictResolution,
  HandoverSnapshot,
  PersistedState,
  ProjectMeta,
  SourceArtifact,
  SourceFact,
  ViewerRole,
  WorkspaceState,
} from "@/lib/types";
import { VIEWER_ROLES } from "@/lib/types";

import seedJson from "../../../supabase/seed/synthetic_payments_project.json";

/* ------------------------------------------------------------------ */
/* Seed                                                                 */
/* ------------------------------------------------------------------ */

interface SeedFile {
  project: ProjectMeta;
  gaps: GapDefinition[];
  sources: Array<Omit<SourceArtifact, "sanitizedContent"> & { facts?: SourceFact[] }>;
}

function normalizeSeed(): { project: ProjectMeta; gaps: GapDefinition[]; sources: SourceArtifact[]; factsBySource: Record<string, SourceFact[]> } {
  const seed = seedJson as unknown as SeedFile;
  const factsBySource: Record<string, SourceFact[]> = {};
  const sources: SourceArtifact[] = seed.sources.map((raw) => {
    const scrubbed = scrubSecrets(raw.rawContent);
    const parsed = SourceArtifactSchema.parse({
      id: raw.id,
      type: raw.type,
      title: raw.title,
      author: raw.author,
      createdAt: raw.createdAt,
      accessTier: raw.accessTier,
      // E-1a: seeds are scrubbed on write too — the stored rawContent is the
      // scrubbed text, never the original unscrubbed archive.
      rawContent: scrubbed.sanitizedText,
      sanitizedContent: scrubbed.sanitizedText,
      metadata:
        scrubbed.redactionCount > 0
          ? {
              ...raw.metadata,
              redactions: { count: scrubbed.redactionCount, types: scrubbed.matchedTypes },
            }
          : raw.metadata,
    });
    factsBySource[parsed.id] = raw.facts ?? [];
    return parsed;
  });
  return { project: seed.project, gaps: seed.gaps, sources, factsBySource };
}

/* ------------------------------------------------------------------ */
/* Persistence interface                                                */
/* ------------------------------------------------------------------ */

interface Persistence {
  readonly mode: "memory" | "supabase";
  init(): Promise<void>;
  loadState(): Promise<PersistedState | null>;
  saveState(state: PersistedState): Promise<void>;
}

class MemoryPersistence implements Persistence {
  readonly mode = "memory" as const;
  private snapshot: PersistedState | null = null;

  async init(): Promise<void> {
    // nothing to do
  }

  async loadState(): Promise<PersistedState | null> {
    return this.snapshot;
  }

  async saveState(state: PersistedState): Promise<void> {
    this.snapshot = state;
  }
}

/* ------------------------------------------------------------------ */
/* Digest (SHA-256)                                                     */
/* ------------------------------------------------------------------ */

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeDigest(state: PersistedState): string {
  const canonical = stableStringify({
    claims: state.claims.map((c) => [c.id, c.status, c.summary, c.superseded ?? false]),
    conflicts: state.conflicts.map((c) => [c.id, c.resolution, c.manualNote ?? ""]),
    gaps: state.gaps.map((g) => [g.id, g.status, g.answers]),
    handover: state.handover,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

export class ProjectStore {
  private persistence: Persistence = new MemoryPersistence();
  private state: PersistedState | null = null;
  private ready: Promise<void> | null = null;
  private seq = 0;
  private persistenceError: string | null = null;

  ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.init();
    }
    return this.ready;
  }

  private async init(): Promise<void> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.info(
      `[chronicle] persistence init: supabaseUrl=${Boolean(supabaseUrl)} serviceKey=${Boolean(serviceKey)}`
    );
    if (supabaseUrl && serviceKey) {
      const candidate = new SupabaseRelationalPersistence(supabaseUrl, serviceKey);
      try {
        await candidate.init();
        const loaded = await candidate.loadState();
        this.persistence = candidate;
        this.state = loaded ?? buildSeedState();
        this.seq = this.state.sources.length + this.state.auditLog.length;
        if (!loaded) await this.persistence.saveState(this.state);
        this.persistenceError = null;
        return;
      } catch (error) {
        this.persistenceError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[chronicle] Supabase unavailable (${this.persistenceError}) — falling back to in-memory store.`
        );
      }
    }

    this.persistence = new MemoryPersistence();
    this.state = buildSeedState();
    await this.persistence.saveState(this.state);
  }

  private async mutate(fn: (state: PersistedState) => Promise<void> | void): Promise<void> {
    await this.ensureReady();
    if (!this.state) throw new Error("store not ready");
    await fn(this.state);
    this.state.handover.digest = computeDigest(this.state);
    try {
      await this.persistence.saveState(this.state);
      this.persistenceError = null;
    } catch (error) {
      this.persistenceError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[chronicle] state write failed (${this.persistenceError}) — continuing with in-memory state.`
      );
    }
  }

  /** Records a tier-scoped mutation rejection (E-2) as its own saved mutation. */
  private async logRejected(actor: string, detail: string): Promise<void> {
    await this.mutate((state) => {
      this.logRaw(state, "MUTATION_REJECTED", actor, detail);
    });
  }

  private logRaw(state: PersistedState, action: AuditAction, actor: string, detail: string): void {
    this.seq += 1;
    const entry: AuditLogEntry = {
      id: `AUD-${String(this.seq).padStart(3, "0")}`,
      ts: new Date().toISOString(),
      actor,
      action,
      detail,
    };
    state.auditLog.push(entry);
    if (state.auditLog.length > 200) {
      state.auditLog = state.auditLog.slice(-200);
    }
  }

  actorForTier(tierValue: AccessTier): string {
    const role = (Object.keys(VIEWER_ROLES) as ViewerRole[]).find(
      (r) => VIEWER_ROLES[r].tier === tierValue
    );
    return role ? VIEWER_ROLES[role].actor : "Maintainer";
  }

  private filterState(viewerTier: AccessTier): WorkspaceState {
    if (!this.state) throw new Error("store not ready");
    const state = this.state;

    const { visibleSources, withheldSourceCount } = filterSourcesByClearance(state.sources, viewerTier);
    const { visibleClaims, withheldClaimCount } = filterClaimsByClearance(state.claims, viewerTier);

    const visibleClaimIds = new Set(visibleClaims.map((c) => c.id));
    const visibleSourceIds = new Set(visibleSources.map((s) => s.id));

    const visibleConflicts = state.conflicts.filter(
      (c) =>
        visibleClaimIds.has(c.sourceA.claimId) && visibleClaimIds.has(c.sourceB.claimId)
    );

    const visibleGaps = state.gaps.filter(
      (g) => g.sourceIds.some((sid) => visibleSourceIds.has(sid))
    );

    const visibleNextActions = state.nextActions.filter(
      (item) => item.ref.startsWith("C-") ? visibleClaimIds.has(item.ref) : visibleGaps.some((g) => g.id === item.ref)
    );

    const visibleWhoToAsk = state.whoToAsk.filter((entry) => visibleSourceIds.has(entry.handle) || state.sources.some((s) => s.author === entry.handle && visibleSourceIds.has(s.id)));

    return {
      mode: this.persistence.mode,
      persistenceError: this.persistenceError ?? undefined,
      project: state.project,
      sources: visibleSources,
      claims: visibleClaims,
      conflicts: visibleConflicts,
      gaps: visibleGaps,
      nextActions: visibleNextActions,
      whoToAsk: visibleWhoToAsk,
      handover: state.handover,
      auditLog: state.auditLog,
      stats: {
        totalSources: state.sources.length,
        visibleSources: visibleSources.length,
        withheldSources: withheldSourceCount,
        totalClaims: state.claims.length,
        visibleClaims: visibleClaims.length,
        withheldClaims: withheldClaimCount,
        verifiedClaims: visibleClaims.filter((c) => c.status === "VERIFIED" || c.status === "HUMAN_APPROVED").length,
        missingEvidenceClaims: visibleClaims.filter((c) => c.status === "MISSING_EVIDENCE").length,
        humanApprovedClaims: visibleClaims.filter((c) => c.status === "HUMAN_APPROVED").length,
        conflicts: visibleConflicts.length,
        unresolvedConflicts: visibleConflicts.filter((c) => c.resolution === "UNRESOLVED").length,
        openGaps: visibleGaps.filter((g) => g.status === "MISSING_EVIDENCE").length,
        totalRedactions: state.sources.reduce((sum, s) => sum + (s.metadata?.redactions?.count ?? 0), 0),
        auditEntries: state.auditLog.length,
      },
    };
  }

  /* ------------------------------ Public API ------------------------------ */

  async getViewerState(viewerTier: AccessTier): Promise<WorkspaceState> {
    await this.ensureReady();
    return this.filterState(viewerTier);
  }

  async ingestSource(
    input: {
      title: string;
      sourceType: SourceArtifact["type"];
      author: string;
      rawText: string;
      accessTier?: AccessTier;
      url?: string;
    },
    actor?: string
  ): Promise<{ source: SourceArtifact; scrub: { redactionCount: number; matchedTypes: string[] } }> {
    const auditActor = actor ?? this.actorForTier(3);
    let created: SourceArtifact = null as never;
    let scrub: { redactionCount: number; matchedTypes: string[]; sanitizedText: string } = {
      redactionCount: 0,
      matchedTypes: [],
      sanitizedText: "",
    };

    await this.mutate((state) => {
      scrub = scrubSecrets(input.rawText);
      const nextSeq = state.sources.length + 1;
      const id = `CUS-${String(nextSeq).padStart(3, "0")}`;
      created = SourceArtifactSchema.parse({
        id,
        type: input.sourceType,
        title: input.title,
        author: input.author,
        createdAt: new Date().toISOString(),
        accessTier: input.accessTier ?? 2,
        // E-1a: only the scrubbed text is ever persisted as rawContent.
        rawContent: scrub.sanitizedText,
        sanitizedContent: scrub.sanitizedText,
        metadata: {
          ...(input.url ? { url: input.url } : {}),
          ...(scrub.redactionCount > 0
            ? { redactions: { count: scrub.redactionCount, types: scrub.matchedTypes } }
            : {}),
        },
      });
      state.sources.push(created);
      // Deterministic candidate extraction: custom sources always yield usable
      // candidate facts even when the LLM reconstruction path is unavailable.
      state.factsBySource[id] = extractCandidateFacts(created);
      this.logRaw(state, "SOURCE_INGESTED", auditActor, `${id} · ${input.title} (${input.sourceType})`);
      if (scrub.redactionCount > 0) {
        this.logRaw(
          state,
          "SECRET_REDACTED",
          auditActor,
          `${scrub.redactionCount} secret(s) scrubbed in ${id}: ${scrub.matchedTypes.join(", ")}`
        );
      }
    });

    return { source: created, scrub };
  }

  async reconstruct(viewerTier: AccessTier, actor?: string): Promise<void> {
    const auditActor = actor ?? this.actorForTier(viewerTier);
    await this.mutate(async (state) => {
      const { visibleSources } = filterSourcesByClearance(state.sources, viewerTier);
      const visibleIds = new Set(visibleSources.map((s) => s.id));
      const visibleFacts: Record<string, SourceFact[]> = {};
      for (const source of visibleSources) {
        visibleFacts[source.id] = state.factsBySource[source.id] ?? [];
      }
      const visibleGapDefs = (seedJson.gaps as GapDefinition[]).filter(
        (g) => g.sourceIds.some((sid) => visibleIds.has(sid))
      );

      const previous: ReconstructionResult = {
        claims: state.claims.filter((c) => c.accessTier <= viewerTier),
        conflicts: state.conflicts,
        gaps: state.gaps,
        nextActions: state.nextActions,
        whoToAsk: state.whoToAsk,
      };
      // B: clearance filtering happens BEFORE the LLM prompt is constructed —
      // only sources the viewer may see ever leave this function.
      const result = await reconstructState(visibleSources, visibleFacts, visibleGapDefs, previous);

      if (viewerTier === 3) {
        // Maintainer view is authoritative and is persisted as the global baseline.
        state.claims = result.claims;
        state.conflicts = result.conflicts;
        state.gaps = result.gaps;
        state.nextActions = result.nextActions;
        state.whoToAsk = result.whoToAsk;
        state.project = { ...state.project, lastReconstructedAt: new Date().toISOString() };
      }

      this.logRaw(
        state,
        "RECONSTRUCT_COMPLETED",
        auditActor,
        `tier=${viewerTier} · ${result.claims.length} claims · ${result.conflicts.length} conflicts · ${result.gaps.length} gaps (heuristic/LLM on visible sources)`
      );
    });
  }

  async verify(
    viewerTier: AccessTier,
    claimIds?: string[],
    actor?: string
  ): Promise<{ downgraded: number; verified: number }> {
    const auditActor = actor ?? this.actorForTier(viewerTier);
    let result = { verified: 0, downgraded: 0 };
    await this.mutate((state) => {
      const targets = claimIds?.length
        ? state.claims.filter((c) => claimIds.includes(c.id) && c.accessTier <= viewerTier)
        : state.claims.filter((c) => c.accessTier <= viewerTier);
      const { verified, downgraded } = verifyClaims(targets, state.sources);
      result = { verified, downgraded };
      this.logRaw(
        state,
        "VERIFICATION_COMPLETED",
        auditActor,
        `${verified} claims quote-grounded · ${downgraded} downgraded to MISSING_EVIDENCE`
      );
    });
    return result;
  }

  async resolveConflict(
    viewerTier: AccessTier,
    conflictId: string,
    choice: Exclude<ConflictResolution, "UNRESOLVED">,
    note?: string,
    actor?: string
  ): Promise<void> {
    const auditActor = actor ?? this.actorForTier(viewerTier);

    // E-2: reject before mutating when the conflict involves a claim above the
    // viewer's clearance. computeClaimAccessTier is the existing source of truth.
    await this.ensureReady();
    const conflict = this.state!.conflicts.find((c) => c.id === conflictId);
    if (!conflict) throw new Error(`conflict not found: ${conflictId}`);
    const losingClaimId = choice === "SOURCE_B" ? conflict.sourceA.claimId : conflict.sourceB.claimId;
    const winningClaimId = choice === "SOURCE_B" ? conflict.sourceB.claimId : conflict.sourceA.claimId;
    const losingClaim = this.state!.claims.find((c) => c.id === losingClaimId);
    const winningClaim = this.state!.claims.find((c) => c.id === winningClaimId);
    const targetTier = Math.max(
      computeClaimAccessTier(winningClaim?.citations ?? []),
      computeClaimAccessTier(losingClaim?.citations ?? [])
    );
    if (targetTier > viewerTier) {
      await this.logRejected(auditActor, `resolve_conflict ${conflictId}: requires tier ${targetTier}`);
      throw new Error(`forbidden: conflict ${conflictId} involves claims above viewer clearance`);
    }

    await this.mutate((state) => {
      const conflict = state.conflicts.find((c) => c.id === conflictId);
      if (!conflict) throw new Error(`conflict not found: ${conflictId}`);

      // D: transactional resolution — demote the losing claim in the same
      // mutation that records the resolution, so verified contradictions can
      // never survive a resolution.
      const losingClaimId = choice === "SOURCE_B" ? conflict.sourceA.claimId : conflict.sourceB.claimId;
      const winningClaimId = choice === "SOURCE_B" ? conflict.sourceB.claimId : conflict.sourceA.claimId;
      const losing = state.claims.find((c) => c.id === losingClaimId);
      const winning = state.claims.find((c) => c.id === winningClaimId);
      if (losing) {
        losing.superseded = true;
        if (losing.status !== "HUMAN_APPROVED") losing.status = "MISSING_EVIDENCE";
      }
      if (winning && winning.status === "EVIDENCE_GATHERED") winning.status = "VERIFIED";

      conflict.resolution = choice;
      conflict.manualNote = note;
      conflict.resolvedAt = new Date().toISOString();
      this.logRaw(
        state,
        "CONFLICT_RESOLVED",
        auditActor,
        `${conflictId} · ${conflict.subject} → ${choice} · ${losingClaimId} superseded${note ? ` · ${note}` : ""}`
      );
    });
  }

  async submitInterview(viewerTier: AccessTier, gapId: string, answers: string[], actor?: string): Promise<void> {
    const auditActor = actor ?? this.actorForTier(viewerTier);

    // E-2: reject before mutating when the gap references sources above the
    // viewer's clearance.
    await this.ensureReady();
    const gap = this.state!.gaps.find((g) => g.id === gapId);
    if (gap) {
      let maxTier: AccessTier = 1;
      for (const sid of gap.sourceIds) {
        const sourceTier = this.state!.sources.find((s) => s.id === sid)?.accessTier ?? 1;
        if (sourceTier > maxTier) maxTier = sourceTier;
      }
      if (maxTier > viewerTier) {
        await this.logRejected(auditActor, `submit_interview ${gapId}: requires tier ${maxTier}`);
        throw new Error(`forbidden: gap ${gapId} references sources above viewer clearance`);
      }
    }

    await this.mutate((state) => {
      const gap = state.gaps.find((g) => g.id === gapId);
      if (!gap) throw new Error(`gap not found: ${gapId}`);
      gap.answers = answers;
      if (gap.answers.every((a) => Boolean(a && a.trim()))) {
        gap.status = "HUMAN_APPROVED";
        gap.approvedAt = new Date().toISOString();
        for (const claim of state.claims) {
          if (claim.gapId === gapId && claim.status !== "HUMAN_APPROVED") {
            claim.status = "HUMAN_APPROVED";
          }
        }
      }
      this.logRaw(
        state,
        "INTERVIEW_COMPLETED",
        auditActor,
        `${gapId} · ${gap.title} → ${gap.status}`
      );
    });
  }

  async editClaim(viewerTier: AccessTier, claimId: string, summary: string, actor?: string): Promise<void> {
    const auditActor = actor ?? this.actorForTier(viewerTier);

    // E-2: reject before mutating when the claim is above the viewer's clearance.
    await this.ensureReady();
    const targetClaim = this.state!.claims.find((c) => c.id === claimId);
    if (!targetClaim) throw new Error(`claim not found: ${claimId}`);
    const claimTier = computeClaimAccessTier(targetClaim.citations);
    if (claimTier > viewerTier) {
      await this.logRejected(auditActor, `edit_claim ${claimId}: requires tier ${claimTier}`);
      throw new Error(`forbidden: claim ${claimId} is above viewer clearance`);
    }

    await this.mutate((state) => {
      const claim = state.claims.find((c) => c.id === claimId);
      if (!claim) throw new Error(`claim not found: ${claimId}`);
      claim.summary = summary;
      if (claim.status === "MISSING_EVIDENCE" && !claim.superseded) {
        claim.status = "HUMAN_APPROVED";
      }
      this.logRaw(
        state,
        "CLAIM_EDITED",
        auditActor,
        `${claimId} · summary edited`
      );
    });
  }

  async lockSnapshot(viewerTier: AccessTier, actor?: string): Promise<HandoverSnapshot> {
    const auditActor = actor ?? this.actorForTier(viewerTier);
    await this.mutate((state) => {
      if (state.handover.locked) return;
      state.handover.version = "v1.0";
      state.handover.locked = true;
      state.handover.lockedAt = new Date().toISOString();
      state.handover.digest = computeDigest(state);
      this.logRaw(state, "SNAPSHOT_LOCKED", auditActor, "Snapshot v1.0 locked & published");
    });
    return this.state!.handover;
  }

  async acknowledgeReceipt(viewerTier: AccessTier, actor?: string): Promise<HandoverSnapshot> {
    const auditActor = actor ?? this.actorForTier(viewerTier);
    await this.mutate((state) => {
      if (!state.handover.locked) throw new Error("snapshot must be locked before receipt acknowledgement");
      if (state.handover.receiptAcknowledged) return;
      state.handover.receiptAcknowledged = true;
      state.handover.receiptAcknowledgedAt = new Date().toISOString();
      state.handover.ackActor = auditActor;
      this.logRaw(state, "RECEIPT_ACKNOWLEDGED", auditActor, "Handover receipt acknowledged");
    });
    return this.state!.handover;
  }

  async resetDemo(viewerTier: AccessTier, actor?: string): Promise<void> {
    await this.mutate((state) => {
      this.logRaw(state, "DEMO_RESET", actor ?? this.actorForTier(viewerTier), "workspace reset to synthetic baseline");
    });
    const fresh = buildSeedState();
    this.state = fresh;
    await this.persistence.saveState(fresh);
  }
}

function buildSeedState(): PersistedState {
  const seed = normalizeSeed();
  const reconstructed = heuristicReconstruct(seed.sources, seed.factsBySource, seed.gaps, undefined);
  const audit: AuditLogEntry[] = [
    {
      id: "AUD-001",
      ts: new Date().toISOString(),
      actor: "System",
      action: "APP_LOADED",
      detail: "8-artifact synthetic workspace loaded (Core-Payments-Service)",
    },
  ];
  return {
    project: seed.project,
    sources: seed.sources,
    factsBySource: seed.factsBySource,
    claims: reconstructed.claims,
    conflicts: reconstructed.conflicts,
    gaps: reconstructed.gaps,
    nextActions: reconstructed.nextActions,
    whoToAsk: reconstructed.whoToAsk,
    handover: {
      version: "v1.0",
      locked: false,
      receiptAcknowledged: false,
      digest: "",
    },
    auditLog: audit,
  };
}

let instance: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  if (!instance) instance = new ProjectStore();
  return instance;
}
