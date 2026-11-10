/**
 * Chronicle — Regex Secret Scrubber.
 *
 * Deterministic, single-pass scrubber for API keys, tokens, database URIs,
 * private keys and private email addresses. Every match is replaced with
 * [REDACTED_SECRET].
 *
 * All token patterns are anchored with a leading word boundary (`\b`) so
 * ordinary hyphenated English words like `task-management-service` (which
 * contains `sk-m…`) are never redacted.
 */
export const REDACTION_PLACEHOLDER = "[REDACTED_SECRET]";

export type SecretType =
  | "OPENAI_STRIPE_KEY"
  | "GITHUB_TOKEN"
  | "AWS_ACCESS_KEY"
  | "GOOGLE_API_KEY"
  | "SLACK_TOKEN"
  | "JWT_TOKEN"
  | "PRIVATE_KEY"
  | "DATABASE_URL"
  | "PRIVATE_EMAIL";

export interface ScrubResult {
  sanitizedText: string;
  redactionCount: number;
  matchedTypes: SecretType[];
}

const COMBINED_PATTERN =
  // OpenAI / Stripe keys: sk-live-..., sk_live_..., sk-...
  "(?:\\bsk[-_][a-zA-Z0-9_-]{12,})" +
  // GitHub classic PATs: ghp_...
  "|(?:\\bghp_[a-zA-Z0-9]{16,})" +
  // GitHub fine-grained PATs: github_pat_...
  "|(?:\\bgithub_pat_[a-zA-Z0-9_]{20,})" +
  // AWS access key ids: AKIA...
  "|(?:\\bAKIA[0-9A-Z]{16})" +
  // Google API keys: AIza...
  "|(?:\\bAIza[0-9A-Za-z_-]{35})" +
  // Slack tokens: xoxb-/xoxp-/xoxa-/xoxr-/xoxs-...
  "|(?:\\bxox[baprs]-[a-zA-Z0-9-]{10,})" +
  // JWT / Bearer tokens
  "|(?:\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{5,})" +
  // PEM private key blocks (redact the entire block)
  "|(?:-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----)" +
  // Database connection URIs
  "|(?:\\b(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis|amqp)://[^\\s\"'<>]+)" +
  // Email addresses (private PII)
  "|(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})";

function classifySecret(value: string): SecretType {
  if (/^sk[-_]/.test(value)) return "OPENAI_STRIPE_KEY";
  if (/^(?:ghp_|github_pat_)/.test(value)) return "GITHUB_TOKEN";
  if (/^AKIA/.test(value)) return "AWS_ACCESS_KEY";
  if (/^AIza/.test(value)) return "GOOGLE_API_KEY";
  if (/^xox/.test(value)) return "SLACK_TOKEN";
  if (/^eyJ/.test(value)) return "JWT_TOKEN";
  if (/^-----BEGIN/.test(value)) return "PRIVATE_KEY";
  if (/^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\//.test(value)) return "DATABASE_URL";
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
