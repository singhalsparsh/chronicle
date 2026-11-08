/**
 * Chronicle — Regex Secret Scrubber.
 *
 * Deterministic, single-pass scrubber for API keys, tokens, database URIs and
 * private email addresses. Every match is replaced with [REDACTED_SECRET].
 */
export const REDACTION_PLACEHOLDER = "[REDACTED_SECRET]";

export type SecretType =
  | "OPENAI_STRIPE_KEY"
  | "GITHUB_TOKEN"
  | "AWS_ACCESS_KEY"
  | "POSTGRES_URL"
  | "PRIVATE_EMAIL";

export interface ScrubResult {
  sanitizedText: string;
  redactionCount: number;
  matchedTypes: SecretType[];
}

const COMBINED_PATTERN =
  // OpenAI / Stripe: sk-live-..., sk_live_..., sk-...
  "(?:sk[-_][a-zA-Z0-9_-]{12,})" +
  // GitHub fine-grained PAT: ghp_...
  "|(?:ghp_[a-zA-Z0-9]{16,})" +
  // AWS access key id: AKIA...
  "|(?:AKIA[0-9A-Z]{16})" +
  // Postgres connection strings
  "|(?:postgres(?:ql)?://[^\\s\"'<>]+)" +
  // Email addresses (private PII)
  "|(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})";

function classifySecret(value: string): SecretType {
  if (/^sk[-_]/.test(value)) return "OPENAI_STRIPE_KEY";
  if (/^ghp_/.test(value)) return "GITHUB_TOKEN";
  if (/^AKIA/.test(value)) return "AWS_ACCESS_KEY";
  if (/^postgres(?:ql)?:\/\//.test(value)) return "POSTGRES_URL";
  return "PRIVATE_EMAIL";
}

/** Count occurrences of a pattern without mutating the input (used for pre-checks). */
export function scrubSecrets(rawText: string): ScrubResult {
  const combined = new RegExp(COMBINED_PATTERN, "gi");
  const parts: string[] = [];
  const matchedTypes = new Set<SecretType>();
  let lastIndex = 0;
  let redactionCount = 0;
  let match: RegExpExecArray | null;

  while ((match = combined.exec(rawText)) !== null) {
    const token = match[0];
    if (token.length === 0) {
      combined.lastIndex += 1;
      continue;
    }
    parts.push(rawText.slice(lastIndex, match.index));
    parts.push(REDACTION_PLACEHOLDER);
    matchedTypes.add(classifySecret(token));
    redactionCount += 1;
    lastIndex = match.index + token.length;
  }
  parts.push(rawText.slice(lastIndex));

  return {
    sanitizedText: parts.join(""),
    redactionCount,
    matchedTypes: Array.from(matchedTypes),
  };
}

/** Lightweight parser used to preview which kinds of secrets exist in a string. */
export function inspectSecrets(rawText: string): { type: SecretType; sample: string }[] {
  const combined = new RegExp(COMBINED_PATTERN, "gi");
  const found: { type: SecretType; sample: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = combined.exec(rawText)) !== null) {
    const token = match[0];
    if (token.length === 0) {
      combined.lastIndex += 1;
      continue;
    }
    found.push({ type: classifySecret(token), sample: token });
  }
  return found;
}
