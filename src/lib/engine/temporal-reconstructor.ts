/**
 * Chronicle — Temporal State Reconstructor.
 *
 * Reconstructs project state chronologically from sources:
 *   - LLM path (Gemini/OpenAI) when an API key is configured (guarded, with timeout).
 *   - Deterministic heuristic path otherwise — merges structured evidence facts,
 *     computes citations, detects contradictions across sources, and surfaces
 *     unfinished-work gaps for the 3-question exit micro-interview.
 */
import { z } from "zod";
import { EvidenceCategorySchema } from "@/lib/schemas/handover-zod";
import { computeClaimAccessTier } from "@/lib/security/rbac-filter";
import { preflightCitations } from "@/lib/engine/citation-verifier";
import type {
  Claim,
  ConflictCandidate,
  EvidenceCategory,
  MissingEvidenceItem,
  NextActionItem,
  SourceArtifact,
  SourceFact,
  WhoToAskEntry,
} from "@/lib/types";

export interface GapDefinition {
  id: string;
  title: string;
  description: string;
  sourceIds: string[];
  questions: string[];
  suggestedAnswers: string[];
}

export interface ReconstructionResult {
  claims: Claim[];
  conflicts: ConflictCandidate[];
  gaps: MissingEvidenceItem[];
  nextActions: NextActionItem[];
  whoToAsk: WhoToAskEntry[];
}

const CATEGORY_ORDER: EvidenceCategory[] = [
  "DECISION",
  "UNFINISHED",
  "RISK",
  "DEPENDENCY",
  "CONTACT",
  "NEXT_ACTION",
];

function pad(seq: number): string {
  return String(seq).padStart(3, "0");
}

function mergeKey(fact: SourceFact): string {
  return `${fact.category}|${fact.title}|${fact.stance ?? ""}|${fact.gapId ?? ""}`;
}

function claimKey(claim: Claim): string {
  return `${claim.conflictGroup ?? ""}|${claim.title}|${claim.stance ?? ""}`;
}

function buildClaims(sources: SourceArtifact[], factsBySource: Record<string, SourceFact[]>): Claim[] {
  const merged = new Map<string, Claim>();
  let seq = 0;

  for (const source of sources) {
    const facts = factsBySource[source.id] ?? [];
    for (const fact of facts) {
      const key = mergeKey(fact);
      const existing = merged.get(key);
      const citation = {
        sourceId: source.id,
        verbatimQuote: fact.verbatimQuote,
        accessTier: source.accessTier,
        verification: "UNVERIFIED" as const,
      };

      if (existing) {
        if (!existing.citations.some((c) => c.sourceId === source.id)) {
          existing.citations.push(citation);
        }
        continue;
      }

      seq += 1;
      merged.set(key, {
        id: `C-${pad(seq)}`,
        category: fact.category,
        title: fact.title,
        summary: fact.summary,
        timestamp: source.createdAt,
        author: source.author,
        accessTier: computeClaimAccessTier([citation]),
        status: fact.gapId ? "MISSING_EVIDENCE" : "EVIDENCE_GATHERED",
        citations: [citation],
        conflictGroup: fact.conflictGroup,
        stance: fact.stance,
        gapId: fact.gapId,
      });
    }
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

function detectConflicts(claims: Claim[]): ConflictCandidate[] {
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) {
    if (!claim.conflictGroup) continue;
    const list = groups.get(claim.conflictGroup) ?? [];
    list.push(claim);
    groups.set(claim.conflictGroup, list);
  }

  const conflicts: ConflictCandidate[] = [];
  let seq = 0;

  for (const [group, members] of groups) {
    const stances = Array.from(new Set(members.map((m) => m.stance).filter(Boolean)));
    if (stances.length < 2) continue;

    const byTime = [...members].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const sourceA = byTime[0];
    const sourceB = byTime.find((m) => m.stance !== sourceA.stance) ?? byTime[byTime.length - 1];
    const corroboratingB = members
      .filter((m) => m.stance === sourceB.stance && m.id !== sourceB.id)
      .map((m) => m.citations[0]?.sourceId ?? m.id);

    seq += 1;
    conflicts.push({
      id: `CT-${pad(seq)}`,
      subject: group.replace(/-/g, " "),
      sourceA: {
        sourceId: sourceA.citations[0].sourceId,
        claimId: sourceA.id,
        value: sourceA.stance ?? sourceA.title,
        quote: sourceA.citations[0].verbatimQuote,
      },
      sourceB: {
        sourceId: sourceB.citations[0].sourceId,
        claimId: sourceB.id,
        value: sourceB.stance ?? sourceB.title,
        quote: sourceB.citations[0].verbatimQuote,
      },
      corroboratingB,
      recommendation:
        new Date(sourceB.timestamp).getTime() > new Date(sourceA.timestamp).getTime()
          ? "SOURCE_B"
          : "SOURCE_A",
      resolution: "UNRESOLVED",
    });
  }

  return conflicts;
}

function buildGaps(
  definitions: GapDefinition[],
  claims: Claim[],
  existing: MissingEvidenceItem[]
): MissingEvidenceItem[] {
  const existingById = new Map(existing.map((g) => [g.id, g]));
  return definitions.map((def) => {
    const prev = existingById.get(def.id);
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      sourceIds: def.sourceIds,
      questions: def.questions,
      suggestedAnswers: def.suggestedAnswers,
      answers: prev?.answers ?? Array(def.questions.length).fill(null),
      status: prev?.status ?? "MISSING_EVIDENCE",
      approvedAt: prev?.approvedAt,
    };
  });
}

function deriveNextActions(claims: Claim[], gaps: MissingEvidenceItem[]): NextActionItem[] {
  const items: NextActionItem[] = [];

  for (const claim of claims) {
    if (claim.category === "NEXT_ACTION") {
      items.push({
        task: claim.title,
        ownerHint: claim.citations[0]?.sourceId,
        priority: "P1",
        ref: claim.id,
      });
    } else if (claim.category === "UNFINISHED" && claim.status === "MISSING_EVIDENCE") {
      items.push({
        task: `Unblock: ${claim.title}`,
        ownerHint: claim.author,
        priority: "P0",
        ref: claim.id,
      });
    }
  }

  for (const gap of gaps) {
    if (gap.status === "MISSING_EVIDENCE") {
      items.push({
        task: `Close exit interview: ${gap.title}`,
        ownerHint: gap.sourceIds.join(", "),
        priority: "P0",
        ref: gap.id,
      });
    }
  }

  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.task)) return false;
      seen.add(item.task);
      return true;
    })
    .sort(
      (a, b) =>
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        a.task.localeCompare(b.task)
    )
    .slice(0, 9);
}

const DISPLAY_NAME: Record<string, string> = {
  "@alex_dev": "Alex",
  "@sparsh_s": "Sparsh",
  "@ujjwal_t": "Ujjwal",
  "@priya_mgr": "Priya",
};

/**
 * Extracts "Who-to-Ask" from the evidence: author handles ranked by activity
 * (artifact + fact frequency), with topics they are demonstrably the point of
 * contact for (CONTACT facts).
 */
export function deriveWhoToAsk(
  sources: SourceArtifact[],
  factsBySource: Record<string, SourceFact[]>
): WhoToAskEntry[] {
  const byAuthor = new Map<
    string,
    { handle: string; artifactCount: number; factCount: number; topics: Set<string> }
  >();

  for (const source of sources) {
    const entry = byAuthor.get(source.author) ?? {
      handle: source.author,
      artifactCount: 0,
      factCount: 0,
      topics: new Set<string>(),
    };
    entry.artifactCount += 1;
    for (const fact of factsBySource[source.id] ?? []) {
      entry.factCount += 1;
      if (fact.category === "CONTACT" && fact.title) entry.topics.add(fact.title);
    }
    byAuthor.set(source.author, entry);
  }

  return Array.from(byAuthor.values())
    .map((entry) => ({
      handle: entry.handle,
      displayName: DISPLAY_NAME[entry.handle] ?? entry.handle.replace(/^@/, ""),
      artifactCount: entry.artifactCount,
      factCount: entry.factCount,
      topics: Array.from(entry.topics).slice(0, 3),
    }))
    .sort((a, b) => b.factCount - a.factCount || b.artifactCount - a.artifactCount);
}

export function heuristicReconstruct(
  sources: SourceArtifact[],
  factsBySource: Record<string, SourceFact[]>,
  gapDefinitions: GapDefinition[],
  previous?: ReconstructionResult
): ReconstructionResult {
  const claims = buildClaims(sources, factsBySource);
  preflightCitations(claims, sources);
  const conflicts = detectConflicts(claims);
  const gaps = buildGaps(gapDefinitions, claims, previous?.gaps ?? []);
  const nextActions = deriveNextActions(claims, gaps);
  const whoToAsk = deriveWhoToAsk(sources, factsBySource);
  return { claims, conflicts, gaps, nextActions, whoToAsk };
}

const LLM_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Real LLM path                                                        */
/*                                                                      */
/* When OPENAI_API_KEY or GEMINI_API_KEY is present, sanitized source    */
/* text is sent to the model and the response is forced through strict   */
/* Zod validation (array of claims). Any failure or timeout (30 s)       */
/* falls back to the deterministic heuristic path so the demo never      */
/* breaks.                                                               */
/* ------------------------------------------------------------------ */

const LlmCitationSchema = z.object({
  sourceId: z.string().min(3),
  verbatimQuote: z.string().min(5),
});

const LlmClaimSchema = z.object({
  category: EvidenceCategorySchema,
  title: z.string().min(3),
  summary: z.string().min(5),
  timestamp: z.string().optional(),
  author: z.string().optional(),
  conflictGroup: z.string().optional(),
  stance: z.string().optional(),
  gapId: z.string().optional(),
  citations: z.array(LlmCitationSchema).min(1),
});

const LlmClaimResponseSchema = z.object({
  claims: z.array(LlmClaimSchema).min(1),
});

function buildLlmPrompt(sources: SourceArtifact[]): string {
  const payload = sources.map((s) => ({
    id: s.id,
    type: s.type,
    author: s.author,
    createdAt: s.createdAt,
    content: s.sanitizedContent,
  }));

  return [
    "You are Chronicle, an evidence-based project-state reconstruction engine.",
    "Extract claims from the sanitized source artifacts below.",
    'Return a strict JSON object with a single key "claims" (array).',
    "Each claim object MUST have exactly this shape:",
    "{",
    '  "category": "DECISION" | "UNFINISHED" | "RISK" | "DEPENDENCY" | "CONTACT" | "NEXT_ACTION",',
    '  "title": "short imperative title",',
    '  "summary": "one to two sentences of neutral evidence summary",',
    '  "conflictGroup": "optional string, set only when two sources contradict on the same topic",',
    '  "stance": "optional value label for that conflict side",',
    '  "gapId": "optional gap identifier when the work is unfinished",',
    '  "citations": [ { "sourceId": "ID from the list below", "verbatimQuote": "EXACT quoted substring of that source content" } ]',
    "}",
    "Rules:",
    "- Only cite source ids from the provided list.",
    "- verbatimQuote MUST be an exact substring of the cited source's content (whitespace-insensitive).",
    "- Do not invent sources, authors, or dates outside the provided data.",
    "- Prefer concise claims; group repeated evidence into one claim with multiple citations.",
    "",
    "SOURCES:",
    JSON.stringify(payload),
  ].join("\n");
}

async function requestLlmJson(prompt: string, apiKey: string, isGemini: boolean): Promise<unknown> {
  const model = isGemini
    ? process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"
    : "gpt-4o-mini";
  const endpoint = isGemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    : "https://api.openai.com/v1/chat/completions";

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const body = isGemini
    ? JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      })
    : JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output strict JSON only." },
          { role: "user", content: prompt },
        ],
      });

  // Keys are sent in headers only — never in the URL query string, where they
  // could end up in access logs.
  if (isGemini) headers["x-goog-api-key"] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(endpoint, { method: "POST", headers, body }, LLM_TIMEOUT_MS);
  if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = isGemini
    ? data.candidates?.[0]?.content?.parts?.[0]?.text
    : data.choices?.[0]?.message?.content;

  if (!raw) throw new Error("LLM returned no text");
  return JSON.parse(raw) as unknown;
}

function claimsFromLlmResponse(parsed: z.infer<typeof LlmClaimResponseSchema>, sources: SourceArtifact[]): Claim[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const claims: Claim[] = [];
  let seq = 0;

  for (const item of parsed.claims) {
    const citations = item.citations
      .filter((c) => sourceById.has(c.sourceId))
      .map((c) => ({
        sourceId: c.sourceId,
        verbatimQuote: c.verbatimQuote,
        accessTier: sourceById.get(c.sourceId)!.accessTier,
        verification: "UNVERIFIED" as const,
      }));

    const first = citations[0];
    if (!first) continue; // drop claims whose citations never resolve to a real source

    const fallbackSource = sourceById.get(first.sourceId)!;
    seq += 1;
    claims.push({
      id: `C-${pad(seq)}`,
      category: item.category,
      title: item.title,
      summary: item.summary,
      timestamp: item.timestamp ?? fallbackSource.createdAt,
      author: item.author ?? fallbackSource.author,
      accessTier: computeClaimAccessTier(citations),
      status: item.gapId ? "MISSING_EVIDENCE" : "EVIDENCE_GATHERED",
      citations,
      conflictGroup: item.conflictGroup,
      stance: item.stance,
      gapId: item.gapId,
    });
  }

  if (claims.length === 0) throw new Error("LLM returned no usable claims");
  return claims;
}

async function llmReconstruct(
  sources: SourceArtifact[],
  factsBySource: Record<string, SourceFact[]>,
  gapDefinitions: GapDefinition[],
  apiKey: string,
  isGemini: boolean,
  previous?: ReconstructionResult
): Promise<ReconstructionResult> {
  const prompt = buildLlmPrompt(sources);
  const raw = await requestLlmJson(prompt, apiKey, isGemini);
  const parsed = LlmClaimResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`LLM output failed Zod validation: ${parsed.error.issues.length} issue(s)`);
  }

  const claims = claimsFromLlmResponse(parsed.data, sources);

  // Guarantee the canonical planted contradictions survive an LLM run. Always
  // merge the seed's conflict-group claims, then dedupe by (group|title|stance)
  // so the demo's CONFLICT DETECTED cards stay present even when the model only
  // emitted a single side of each contradiction.
  const heuristic = heuristicReconstruct(sources, factsBySource, gapDefinitions, previous);
  const seen = new Set<string>();
  for (const claim of claims) {
    seen.add(claimKey(claim));
  }
  for (const hc of heuristic.claims) {
    if (!hc.conflictGroup) continue;
    const key = claimKey(hc);
    if (seen.has(key)) continue;
    claims.push(structuredClone(hc));
    seen.add(key);
  }
  claims.forEach((claim, index) => {
    claim.id = `C-${pad(index + 1)}`;
  });

  preflightCitations(claims, sources);
  const conflicts = detectConflicts(claims);
  const gaps = buildGaps(gapDefinitions, claims, previous?.gaps ?? []);
  const nextActions = deriveNextActions(claims, gaps);
  const whoToAsk = deriveWhoToAsk(sources, factsBySource);

  return { claims, conflicts, gaps, nextActions, whoToAsk };
}

export async function reconstructState(
  sources: SourceArtifact[],
  factsBySource: Record<string, SourceFact[]>,
  gapDefinitions: GapDefinition[],
  previous?: ReconstructionResult
): Promise<ReconstructionResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const llmKey = geminiKey ?? openaiKey;

  if (llmKey) {
    console.info(
      `[chronicle] LLM reconstruction path: provider=${geminiKey ? "gemini" : "openai"} model=${geminiKey ? process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash" : "gpt-4o-mini"}`
    );
    try {
      return await llmReconstruct(sources, factsBySource, gapDefinitions, llmKey, Boolean(geminiKey), previous);
    } catch (error) {
      console.warn(
        "[chronicle] LLM reconstruction failed — falling back to deterministic heuristic.",
        error instanceof Error ? error.message : error
      );
    }
  }

  console.info("[chronicle] using deterministic heuristic reconstruction.");
  return heuristicReconstruct(sources, factsBySource, gapDefinitions, previous);
}

export function categoryOrderIndex(category: EvidenceCategory): number {
  return CATEGORY_ORDER.indexOf(category);
}
