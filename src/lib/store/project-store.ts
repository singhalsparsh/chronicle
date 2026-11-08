/**
 * Chronicle — Hybrid persistence layer.
 *
 * Uses Supabase (PostgREST) when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * are configured; otherwise falls back to a pre-seeded stateful in-memory store so
 * the deployed demo works with zero configuration friction.
 */
import { SourceArtifactSchema, PersistedStateSchema } from "@/lib/schemas/handover-zod";
import { scrubSecrets } from "@/lib/security/secret-scrubber";
import { filterClaimsByClearance, filterSourcesByClearance } from "@/lib/security/rbac-filter";
import { verifyClaims } from "@/lib/engine/citation-verifier";
import { heuristicReconstruct, reconstructState, type GapDefinition, type ReconstructionResult } from "@/lib/engine/temporal-reconstructor";
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
      rawContent: raw.rawContent,
      sanitizedContent: scrubbed.sanitizedText,
      metadata: raw.metadata,
    });
    factsBySource[parsed.id] = raw.facts ?? [];
    return parsed;
  });
  return { project: seed.project, gaps: seed.gaps, sources, factsBySource };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */

interface Persistence {
  readonly mode: "memory" | "supabase";
  init(): Promise<void>;
  loadSnapshot(): Promise<PersistedState | null>;
  saveSnapshot(state: PersistedState): Promise<void>;
}

class MemoryPersistence implements Persistence {
  readonly mode = "memory" as const;
  private snapshot: PersistedState | null = null;

  async init(): Promise<void> {
    // nothing to do
  }

  async loadSnapshot(): Promise<PersistedState | null> {
    return this.snapshot;
  }

  async saveSnapshot(state: PersistedState): Promise<void> {
    this.snapshot = state;
  }
}

class SupabasePersistence implements Persistence {
  readonly mode = "supabase" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly table = "chronicle_state";

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.baseUrl = supabaseUrl.replace(/\/$/, "") + "/rest/v1";
    this.apiKey = serviceRoleKey;
  }

  private headers(prefer?: string): Record<string, string> {
    const headers: Record<string, string> = {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    return headers;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${this.table}?select=id&limit=1`, {
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase init failed (${res.status})`);
    }
  }

  async loadSnapshot(): Promise<PersistedState | null> {
    const res = await fetch(`${this.baseUrl}/${this.table}?select=state&limit=1`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ state?: unknown }>;
    const row = rows[0];
    if (!row?.state) return null;
    const parsed = PersistedStateSchema.safeParse(row.state);
    return parsed.success ? parsed.data : null;
  }

  async saveSnapshot(state: PersistedState): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${this.table}`, {
      method: "POST",
      headers: this.headers("resolution=merge-duplicates"),
      body: JSON.stringify({ id: "main", state, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      throw new Error(`Supabase save failed (${res.status})`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Digest                                                               */
/* ------------------------------------------------------------------ */

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function computeDigest(state: PersistedState): string {
  const canonical = JSON.stringify({
    claims: state.claims.map((c) => [c.id, c.status, c.summary]),
    conflicts: state.conflicts.map((c) => [c.id, c.resolution, c.manualNote ?? ""]),
    gaps: state.gaps.map((g) => [g.id, g.status, g.answers]),
    handover: state.handover,
  });
  return djb2(canonical);
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
      const candidate = new SupabasePersistence(supabaseUrl, serviceKey);
      try {
        await candidate.init();
        const snapshot = await candidate.loadSnapshot();
        this.persistence = candidate;
        this.state = snapshot ?? buildSeedState();
        this.seq = this.state.sources.length + this.state.auditLog.length;
        if (!snapshot) await this.persistence.saveSnapshot(this.state);
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
    await this.persistence.saveSnapshot(this.state);
  }

  private async mutate(fn: (state: PersistedState) => Promise<void> | void): Promise<void> {
    await this.ensureReady();
    if (!this.state) throw new Error("store not ready");
    await fn(this.state);
    this.state.handover.digest = computeDigest(this.state);
    try {
      await this.persistence.saveSnapshot(this.state);
      this.persistenceError = null;
    } catch (error) {
      // Persistence is best-effort: a transient Supabase failure must never
      // break the demo. The local state remains authoritative for this session.
      this.persistenceError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[chronicle] snapshot write failed (${this.persistenceError}) — continuing with in-memory state.`
      );
    }
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
        totalRedactions: state.sources.reduce((sum, s) => sum + scrubSecrets(s.rawContent).redactionCount, 0),
        auditEntries: state.auditLog.length,
      },
    };
  }

  /* ------------------------------ Public API ------------------------------ */

  async getViewerState(viewerTier: AccessTier): Promise<WorkspaceState> {
    await this.ensureReady();
    return this.filterState(viewerTier);
  }

  async ingestSource(input: {
    title: string;
    sourceType: SourceArtifact["type"];
    author: string;
    rawText: string;
    accessTier?: AccessTier;
    url?: string;
  }): Promise<{ source: SourceArtifact; scrub: { redactionCount: number; matchedTypes: string[] } }> {
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
        rawContent: input.rawText,
        sanitizedContent: scrub.sanitizedText,
        metadata: input.url ? { url: input.url } : undefined,
      });
      state.sources.push(created);
      state.factsBySource[id] = [];
      this.logRaw(state, "SOURCE_INGESTED", this.actorForTier(3), `${id} · ${input.title} (${input.sourceType})`);
      if (scrub.redactionCount > 0) {
        this.logRaw(
          state,
          "SECRET_REDACTED",
          this.actorForTier(3),
          `${scrub.redactionCount} secret(s) scrubbed in ${id}: ${scrub.matchedTypes.join(", ")}`
        );
      }
    });

    return { source: created, scrub };
  }

  async reconstruct(viewerTier: AccessTier): Promise<void> {
    await this.mutate(async (state) => {
      const previous: ReconstructionResult = {
        claims: state.claims,
        conflicts: state.conflicts,
        gaps: state.gaps,
        nextActions: state.nextActions,
        whoToAsk: state.whoToAsk,
      };
      const result = await reconstructState(
        state.sources,
        state.factsBySource,
        seedJson.gaps as GapDefinition[],
        previous
      );
      state.claims = result.claims;
      state.conflicts = result.conflicts;
      state.gaps = result.gaps;
      state.nextActions = result.nextActions;
      state.whoToAsk = result.whoToAsk;
      state.project = { ...state.project, lastReconstructedAt: new Date().toISOString() };
      this.logRaw(
        state,
        "RECONSTRUCT_COMPLETED",
        this.actorForTier(viewerTier),
        `${state.claims.length} claims · ${state.conflicts.length} conflicts · ${state.gaps.length} gaps`
      );
    });
  }

  async verify(viewerTier: AccessTier, claimIds?: string[]): Promise<{ downgraded: number; verified: number }> {
    let result = { verified: 0, downgraded: 0 };
    await this.mutate((state) => {
      const targets = claimIds?.length
        ? state.claims.filter((c) => claimIds.includes(c.id))
        : state.claims;
      const { verified, downgraded } = verifyClaims(targets, state.sources);
      result = { verified, downgraded };
      this.logRaw(
        state,
        "VERIFICATION_COMPLETED",
        this.actorForTier(viewerTier),
        `${verified} claims quote-grounded · ${downgraded} downgraded to MISSING_EVIDENCE`
      );
    });
    return result;
  }

  async resolveConflict(
    viewerTier: AccessTier,
    conflictId: string,
    choice: Exclude<ConflictResolution, "UNRESOLVED">,
    note?: string
  ): Promise<void> {
    await this.mutate((state) => {
      const conflict = state.conflicts.find((c) => c.id === conflictId);
      if (!conflict) throw new Error(`conflict not found: ${conflictId}`);
      conflict.resolution = choice;
      conflict.manualNote = note;
      conflict.resolvedAt = new Date().toISOString();
      this.logRaw(
        state,
        "CONFLICT_RESOLVED",
        this.actorForTier(viewerTier),
        `${conflictId} · ${conflict.subject} → ${choice}${note ? ` · ${note}` : ""}`
      );
    });
  }

  async submitInterview(viewerTier: AccessTier, gapId: string, answers: string[]): Promise<void> {
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
        this.actorForTier(viewerTier),
        `${gapId} · ${gap.title} → ${gap.status}`
      );
    });
  }

  async editClaim(viewerTier: AccessTier, claimId: string, summary: string): Promise<void> {
    await this.mutate((state) => {
      const claim = state.claims.find((c) => c.id === claimId);
      if (!claim) throw new Error(`claim not found: ${claimId}`);
      claim.summary = summary;
      if (claim.status === "MISSING_EVIDENCE") {
        claim.status = "HUMAN_APPROVED";
      }
      this.logRaw(
        state,
        "CLAIM_EDITED",
        this.actorForTier(viewerTier),
        `${claimId} · summary edited`
      );
    });
  }

  async lockSnapshot(viewerTier: AccessTier): Promise<HandoverSnapshot> {
    await this.mutate((state) => {
      if (state.handover.locked) return;
      state.handover.version = "v1.0";
      state.handover.locked = true;
      state.handover.lockedAt = new Date().toISOString();
      state.handover.digest = computeDigest(state);
      this.logRaw(state, "SNAPSHOT_LOCKED", this.actorForTier(viewerTier), "Snapshot v1.0 locked & published");
    });
    return this.state!.handover;
  }

  async acknowledgeReceipt(viewerTier: AccessTier): Promise<HandoverSnapshot> {
    await this.mutate((state) => {
      if (!state.handover.locked) throw new Error("snapshot must be locked before receipt acknowledgement");
      if (state.handover.receiptAcknowledged) return;
      state.handover.receiptAcknowledged = true;
      state.handover.receiptAcknowledgedAt = new Date().toISOString();
      state.handover.ackActor = this.actorForTier(viewerTier);
      this.logRaw(state, "RECEIPT_ACKNOWLEDGED", this.actorForTier(viewerTier), "Handover receipt acknowledged");
    });
    return this.state!.handover;
  }

  async resetDemo(viewerTier: AccessTier): Promise<void> {
    await this.mutate((state) => {
      this.logRaw(state, "DEMO_RESET", this.actorForTier(viewerTier), "workspace reset to synthetic baseline");
    });
    const fresh = buildSeedState();
    this.state = fresh;
    await this.persistence.saveSnapshot(fresh);
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
      detail: "28-artifact synthetic workspace loaded (Core-Payments-Service)",
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
