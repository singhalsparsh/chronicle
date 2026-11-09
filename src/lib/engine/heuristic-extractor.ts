/**
 * Chronicle — Deterministic candidate-fact extraction.
 *
 * Extracts candidate facts from arbitrary source text WITHOUT an LLM so custom
 * ingestion never silently produces "no facts". Candidates are marked
 * `candidate: true` and start in EVIDENCE_GATHERED until they are grounded by
 * citation verification and reviewed — the claim pipeline treats them exactly
 * like authored facts, but provenance is explicit.
 */
import type { EvidenceCategory, SourceArtifact, SourceFact } from "@/lib/types";

const CATEGORY_SIGNALS: Record<EvidenceCategory, RegExp[]> = {
  DECISION: [
    /\b(we|i)\s+(decided|chose|chosen|adopted|will use|switched|replaced|migrated|moved|rolled out|shipped|introduced|dropped|removed|added|standardized|set up)\b/i,
    /\b(decision|design|approach|plan|policy|standard)\b/i,
  ],
  UNFINISHED: [
    /\b(todo|wip|in progress|still pending|pending|not yet|not done|open question|commented out|blocked|needs review|awaiting|unfinished|remaining|to close out)\b/i,
    /\b(should be done|must be completed|left to|yet to)\b/i,
  ],
  RISK: [
    /\b(risk|incident|outage|failure|failed|vulnerability|exposure|leak|breach|regression|bug|latency|exhaustion|downtime|cannot|could not|unable|fragile|unsafe)\b/i,
  ],
  DEPENDENCY: [
    /\b(depends on|relies on|blocked by|requires|needs|uses|integrated with|talks to|built on|via)\b/i,
  ],
  CONTACT: [
    /@[a-zA-Z0-9_.-]+/,
    /\b(talk to|ask|reach out|contact|ping|pager|on-call)\b/i,
  ],
  NEXT_ACTION: [
    /\b(should|must|need to|will|next steps|follow-up|follow up|rotate|wire|deploy|review|merge|schedule|close out|remaining work)\b/i,
    /\b(create|add|fix|update|implement|migrate|remove|deprecate)\b/i,
  ],
};

function detectCategory(text: string): EvidenceCategory | null {
  const lowered = text.toLowerCase();
  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS) as [EvidenceCategory, RegExp[]][]) {
    for (const re of signals) {
      if (re.test(lowered)) return category;
    }
  }
  return null;
}

function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/u);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length >= 24 && s.length <= 400);
}

function makeTitle(sentence: string): string {
  const trimmed = sentence.replace(/\.$/, "").trim();
  const firstClause = trimmed.split(/[,;:]/)[0] ?? trimmed;
  const words = firstClause.split(/\s+/);
  const title = words.slice(0, 9).join(" ");
  return title.length > 8 ? title : trimmed.slice(0, 56);
}

export function extractCandidateFacts(source: SourceArtifact): SourceFact[] {
  const facts: SourceFact[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(source.sanitizedContent)) {
    const category = detectCategory(sentence);
    // A CONTACT sentence needs an explicit handle to be useful.
    if (!category) continue;
    if (category === "CONTACT" && !/@[a-zA-Z0-9_.-]+/.test(sentence)) continue;

    const key = `${category}|${sentence.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const handleMatch = sentence.match(/@[a-zA-Z0-9_.-]+/);
    facts.push({
      category,
      title: makeTitle(sentence),
      summary: sentence,
      verbatimQuote: sentence,
      suggests: handleMatch?.[0],
      candidate: true,
    });
  }

  return facts;
}
