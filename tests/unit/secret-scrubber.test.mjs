import test from "node:test";
import assert from "node:assert/strict";
import { scrubSecrets, inspectSecrets } from "../../src/lib/security/secret-scrubber.ts";

// Token fixtures are built by concatenation so the literal source text never
// contains a contiguous high-confidence secret shape (GitHub secret scanning
// blocks pushes containing e.g. a full `github_pat_…` or `AIzaSy…` token,
// even test fixtures). At runtime the strings are real patterns and the
// scrubber must catch them.

const sk = "sk-live-" + "TEST123";
const ghClassic = "ghp" + "_TOKEN4567890123456";
const ghFine = "github_pat" + "_11AAbb22CCdd33EE44ff55";
const aws = "AKIAIOSFODNN7EXAMPLE";
const google = "AIza" + "Sy-very-long-google-api-key-1234567890";
const slack = "xoxb" + "-123456789012-123456789012-abcdefghijklmn";
const jwt = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
].join(".");
const pem = "-----BEGIN RSA" + " PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA" + " PRIVATE KEY-----";

test("no false positives on hyphenated English words", () => {
  const text =
    "the task-management-service was moved to risk-assessment-report-2026 before the handover";
  const out = scrubSecrets(text);
  assert.equal(out.redactionCount, 0);
  assert.equal(out.sanitizedText, text);
});

test("redacts OpenAI/Stripe sk- keys", () => {
  const out = scrubSecrets(`deploy with ${sk} and sk_live_abcDEFxyz`);
  assert.equal(out.redactionCount, 2);
  assert.ok(out.sanitizedText.includes("[REDACTED_SECRET]"));
  assert.deepEqual(out.matchedTypes, ["OPENAI_STRIPE_KEY"]);
});

test("redacts GitHub classic and fine-grained PATs", () => {
  const out = scrubSecrets(`token ${ghClassic} plus ${ghFine}`);
  assert.equal(out.redactionCount, 2);
  assert.deepEqual([...out.matchedTypes].sort(), ["GITHUB_TOKEN"]);
});

test("redacts AWS, Google, Slack and JWT tokens", () => {
  const out = scrubSecrets(`${aws} ${google} ${slack} ${jwt}`);
  assert.equal(out.redactionCount, 4);
  assert.ok(out.matchedTypes.includes("AWS_ACCESS_KEY"));
  assert.ok(out.matchedTypes.includes("GOOGLE_API_KEY"));
  assert.ok(out.matchedTypes.includes("SLACK_TOKEN"));
  assert.ok(out.matchedTypes.includes("JWT_TOKEN"));
});

test("redacts full PEM private key blocks", () => {
  const out = scrubSecrets(`config ${pem} end`);
  assert.equal(out.redactionCount, 1);
  assert.ok(out.matchedTypes.includes("PRIVATE_KEY"));
  assert.ok(!out.sanitizedText.includes("MIIEpAIBAAKCAQEA"));
});

test("redacts database connection URIs (postgres, mysql, mongodb, redis)", () => {
  const out = scrubSecrets(
    "postgres://user:password@db.example.com:5432/prod " +
      "mysql://u:p@host:3306/db mongodb+srv://u:p@cluster.example.com/app redis://:pw@localhost:6379/0"
  );
  assert.equal(out.redactionCount, 4);
  assert.ok(out.matchedTypes.every((t) => t === "DATABASE_URL"));
});

test("redacts private email addresses", () => {
  const out = scrubSecrets("contact alex.dev@protonmail.com please");
  assert.equal(out.redactionCount, 1);
  assert.deepEqual(out.matchedTypes, ["PRIVATE_EMAIL"]);
});

test("ordered replaces are deterministic across repeated runs", () => {
  const text = `${sk} ${ghClassic} postgres://u:p@h:5432/db a@b.com`;
  const a = scrubSecrets(text);
  const b = scrubSecrets(text);
  assert.equal(a.sanitizedText, b.sanitizedText);
  assert.equal(a.redactionCount, b.redactionCount);
});

test("inspectSecrets returns samples and types", () => {
  const found = inspectSecrets(`${sk} ${ghClassic}`);
  assert.equal(found.length, 2);
  assert.equal(found[0].type, "OPENAI_STRIPE_KEY");
  assert.equal(found[1].type, "GITHUB_TOKEN");
});
