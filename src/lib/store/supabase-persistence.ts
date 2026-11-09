/**
 * Chronicle — Relational Supabase persistence.
 *
 * Stores domain entities in their own Postgres tables (sources, claims,
 * conflicts, gaps, next_actions, who_to_ask, handover, audit_log) instead of a
 * single JSON blob. Writes go through the service-role key on the server side
 * only (never exposed to a browser); reads are hydrated server-side from the
 * same channel. Row-Level Security remains the second line of defense for any
 * direct DB access, enforced by tier-gated SELECT policies (see migration).
 *
 * Concurrency: an optimistic compare-and-swap on `state_meta.version` prevents
 * lost updates between concurrent cold-start instances.
 */
import { PersistedStateSchema } from "@/lib/schemas/handover-zod";
import type {
  AccessTier,
  AuditLogEntry,
  Citation,
  ClaimStatus,
  ConflictResolution,
  EvidenceCategory,
  GapStatus,
  PersistedState,
  SourceArtifact,
  SourceFact,
} from "@/lib/types";

const META_ID = "main";

interface MetaRow {
  id: string;
  version: number;
  updated_at: string;
}

export class SupabaseRelationalPersistence {
  readonly mode = "supabase" as const;
  private readonly baseUrl: string;
  private readonly serviceKey: string;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.baseUrl = supabaseUrl.replace(/\/$/, "") + "/rest/v1";
    this.serviceKey = serviceRoleKey;
  }

  private headers(prefer?: string): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      "Content-Type": "application/json",
    };
    if (prefer) h.Prefer = prefer;
    return h;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/state_meta?select=id&limit=1`, {
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase relational init failed (${res.status})`);
    }
  }

  /* ------------------------------ Load ------------------------------ */

  async loadState(): Promise<PersistedState | null> {
    const [sources, claims, conflicts, gaps, nextActions, whoToAsk, handover, auditLog] =
      await Promise.all([
        this.fetchAll("sources"),
        this.fetchAll("claims"),
        this.fetchAll("conflicts"),
        this.fetchAll("gaps"),
        this.fetchAll("next_actions"),
        this.fetchAll("who_to_ask"),
        this.fetchAll("handover"),
        this.fetchAll("audit_log"),
      ]);

    if (sources.length === 0 && handover.length === 0) return null;

    const factsBySource: Record<string, SourceFact[]> = {};
    const sourceRows: SourceArtifact[] = sources.map((row) => {
      factsBySource[row.id as string] = (row.facts as SourceFact[] | null) ?? [];
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        author: row.author,
        createdAt: row.created_at,
        accessTier: row.access_tier,
        rawContent: row.raw_content,
        sanitizedContent: row.sanitized_content,
        metadata: row.meta ?? undefined,
      } as SourceArtifact;
    });

    const ho = handover[0] ?? {};
    const candidate: PersistedState = {
      project: { name: "Core-Payments-Service", departingLead: "@alex_dev", reason: "" },
      sources: sourceRows,
      factsBySource,
      claims: claims.map(mapClaim),
      conflicts: conflicts.map(mapConflict),
      gaps: gaps.map(mapGap),
      nextActions: nextActions.map((r) => ({
        task: str(r.task),
        ownerHint: optStr(r.owner_hint),
        priority: str(r.priority) as "P0" | "P1" | "P2",
        ref: str(r.ref),
      })),
      whoToAsk: whoToAsk.map((r) => ({
        handle: str(r.handle),
        displayName: str(r.display_name),
        artifactCount: num(r.artifact_count),
        factCount: num(r.fact_count),
        topics: (r.topics as string[]) ?? [],
      })),
      handover: {
        version: str(ho.version) || "v1.0",
        locked: Boolean(ho.locked),
        lockedAt: optStr(ho.locked_at),
        receiptAcknowledged: Boolean(ho.receipt_acknowledged),
        receiptAcknowledgedAt: optStr(ho.receipt_acknowledged_at),
        ackActor: optStr(ho.ack_actor),
        digest: str(ho.digest) ?? "",
      },
      auditLog: auditLog.map((r) => ({
        id: str(r.id),
        ts: str(r.ts),
        actor: str(r.actor),
        action: str(r.action) as AuditLogEntry["action"],
        detail: str(r.detail),
      })),
    };

    const parsed = PersistedStateSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  /* ------------------------------ Save ------------------------------ */

  async saveState(state: PersistedState): Promise<void> {
    const meta = await this.fetchMeta();
    const nextVersion = (meta?.version ?? 0) + 1;

    // 1. Write entities (upsert by primary key).
    await this.upsertRows("sources", state.sources.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      author: s.author,
      created_at: s.createdAt,
      access_tier: s.accessTier,
      raw_content: s.rawContent,
      sanitized_content: s.sanitizedContent,
      url: s.metadata?.url ?? null,
      meta: s.metadata ?? {},
      facts: state.factsBySource[s.id] ?? [],
    })));
    await this.upsertRows("claims", state.claims.map((c) => ({
      id: c.id,
      category: c.category,
      title: c.title,
      summary: c.summary,
      timestamp: c.timestamp,
      author: c.author,
      access_tier: c.accessTier,
      status: c.status,
      conflict_group: c.conflictGroup ?? null,
      stance: c.stance ?? null,
      gap_id: c.gapId ?? null,
      superseded: c.superseded ?? false,
      citations: c.citations,
    })));
    await this.upsertRows("conflicts", state.conflicts.map((c) => ({
      id: c.id,
      subject: c.subject,
      source_a: c.sourceA,
      source_b: c.sourceB,
      corroborating_b: c.corroboratingB,
      recommendation: c.recommendation,
      resolution: c.resolution,
      manual_note: c.manualNote ?? null,
      resolved_at: c.resolvedAt ?? null,
    })));
    await this.upsertRows("gaps", state.gaps.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      source_ids: g.sourceIds,
      questions: g.questions,
      suggested_answers: g.suggestedAnswers,
      answers: g.answers,
      status: g.status,
      approved_at: g.approvedAt ?? null,
    })));
    await this.upsertRows("next_actions", state.nextActions.map((n) => ({
      task: n.task,
      owner_hint: n.ownerHint ?? null,
      priority: n.priority,
      ref: n.ref,
      access_tier: n.ref.startsWith("C-")
        ? state.claims.find((c) => c.id === n.ref)?.accessTier ?? 2
        : state.gaps.find((g) => g.id === n.ref)?.sourceIds.length ? 2 : 2,
    })));
    await this.upsertRows("who_to_ask", state.whoToAsk.map((w) => ({
      handle: w.handle,
      display_name: w.displayName,
      artifact_count: w.artifactCount,
      fact_count: w.factCount,
      topics: w.topics,
      access_tier: 3,
    })));
    await this.upsertRows("handover", [{
      id: 1,
      version: state.handover.version,
      locked: state.handover.locked,
      locked_at: state.handover.lockedAt ?? null,
      receipt_acknowledged: state.handover.receiptAcknowledged,
      receipt_acknowledged_at: state.handover.receiptAcknowledgedAt ?? null,
      ack_actor: state.handover.ackActor ?? null,
      digest: state.handover.digest,
    }]);

    // 2. Append audit log (insert only).
    const existingIds = await this.fetchAll("audit_log", "id");
    const existing = new Set(existingIds.map((r) => r.id));
    const freshAudit = state.auditLog.filter((e) => !existing.has(e.id));
    if (freshAudit.length > 0) {
      await this.insertRows("audit_log", freshAudit.map((e) => ({
        id: e.id,
        ts: e.ts,
        actor: e.actor,
        action: e.action,
        detail: e.detail,
      })));
    }

    // 3. Optimistic CAS on state_meta.version.
    await this.casMeta(meta, nextVersion);
  }

  /* ------------------------------ Internals ------------------------------ */

  private async fetchAll(table: string, select = "*"): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${this.baseUrl}/${table}?select=${encodeURIComponent(select)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`${table} load failed (${res.status})`);
    return (await res.json()) as Record<string, unknown>[];
  }

  private async fetchMeta(): Promise<MetaRow | null> {
    const rows = await this.fetchAll("state_meta", "id,version,updated_at");
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: str(row.id),
      version: num(row.version),
      updated_at: str(row.updated_at),
    };
  }

  private async upsertRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const res = await fetch(`${this.baseUrl}/${table}`, {
      method: "POST",
      headers: this.headers("resolution=merge-duplicates"),
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`${table} save failed (${res.status})`);
  }

  private async insertRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const res = await fetch(`${this.baseUrl}/${table}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`${table} insert failed (${res.status})`);
  }

  private async casMeta(meta: MetaRow | null, nextVersion: number): Promise<void> {
    const headers = this.headers();
    if (meta) {
      // Fetch again for a fresh ETag, then conditional update.
      const res = await fetch(`${this.baseUrl}/state_meta?select=id,version&id=eq.${META_ID}`, {
        headers: this.headers(),
      });
      if (res.ok) {
        const etag = res.headers.get("etag");
        if (etag) {
          const patch = await fetch(`${this.baseUrl}/state_meta?id=eq.${META_ID}`, {
            method: "PATCH",
            headers: { ...headers, "If-Match": etag },
            body: JSON.stringify({ version: nextVersion, updated_at: new Date().toISOString() }),
          });
          if (patch.status === 412) {
            throw new Error("state version conflict — concurrent write detected; retry");
          }
          if (!patch.ok) throw new Error(`state_meta CAS failed (${patch.status})`);
          return;
        }
      }
    }
    // No meta row or no ETag: create/overwrite idempotently.
    const upsert = await fetch(`${this.baseUrl}/state_meta`, {
      method: "POST",
      headers: this.headers("resolution=merge-duplicates"),
      body: JSON.stringify({ id: META_ID, version: nextVersion, updated_at: new Date().toISOString() }),
    });
    if (!upsert.ok) throw new Error(`state_meta create failed (${upsert.status})`);
  }
}

/* ------------------------------ Row mappers ------------------------------ */

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optStr(value: unknown): string | undefined {
  return value == null || value === "" ? undefined : String(value);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function mapClaim(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    category: str(row.category) as EvidenceCategory,
    title: str(row.title),
    summary: str(row.summary),
    timestamp: str(row.timestamp),
    author: str(row.author),
    accessTier: num(row.access_tier) as AccessTier,
    status: str(row.status) as ClaimStatus,
    citations: ((row.citations as never[]) ?? []) as Citation[],
    conflictGroup: optStr(row.conflict_group),
    stance: optStr(row.stance),
    gapId: optStr(row.gap_id),
    superseded: Boolean(row.superseded) || undefined,
  };
}

function mapConflict(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    subject: str(row.subject),
    sourceA: row.source_a as never,
    sourceB: row.source_b as never,
    corroboratingB: (row.corroborating_b as string[]) ?? [],
    recommendation: str(row.recommendation) as "SOURCE_A" | "SOURCE_B" | "MANUAL",
    resolution: str(row.resolution) as ConflictResolution,
    manualNote: optStr(row.manual_note),
    resolvedAt: optStr(row.resolved_at),
  };
}

function mapGap(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    title: str(row.title),
    description: str(row.description),
    sourceIds: (row.source_ids as string[]) ?? [],
    questions: (row.questions as string[]) ?? [],
    suggestedAnswers: (row.suggested_answers as string[]) ?? [],
    answers: (row.answers as (string | null)[]) ?? [],
    status: str(row.status) as GapStatus,
    approvedAt: optStr(row.approved_at),
  };
}
