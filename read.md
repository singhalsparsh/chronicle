# read.md â€” Orientation for the Next Agent

This file tells a new agent (human or LLM) what Chronicle is, what is implemented, and how to
extend it without breaking things.

## 1. What this project is

Chronicle is a Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/ui Base UI) web app:
**Evidence-Linked Project State Reconstruction & Permissioned Handover**. It rebuilds the state of a
software project from raw evidence artifacts and hands it off to an incoming owner with role-based
visibility, quote-grounded citations, and an audit trail.

**What is actually integrated (no overclaiming):**
- GitHub PR ingestion fetches the **title/body** of a public PR via the GitHub API. It does *not*
  fetch comments, reviews, or diffs.
- Slack threads, Jira tickets, and Notion docs are ingested as **pasted text** — there is no live
  integration with those platforms.
- Everything else in the demo (the 8-artifact workspace) is a **seeded synthetic dataset** for
  `Core-Payments-Service`.

Entry is a one-click demo identity (Alex T3 / Sam T2 / Jordan T1) bound to a signed session cookie;
no passwords. **This is a demo login, not user authentication** — anyone with access can assume any
of the three roles, so RBAC here demonstrates the permission model, not a security boundary.

### Round 3 features (implemented)

- **Who-to-Ask extraction** â€” the engine derives contact handles from the evidence
  (`deriveWhoToAsk`), ranked by artifact/fact frequency with their CONTACT topics.
- **Handover packet export** â€” `GET /api/handover/export` returns the locked v1.0 snapshot as a
  downloadable Markdown packet (verified claims, who-to-ask, next actions, evidence sources, audit
  log). Guarded with 409 until the snapshot is locked.
- **Real GitHub ingestion** â€” pasting a `github.com/{owner}/{repo}/pull/{n}` URL fetches the real
  PR **title/body** from the GitHub public API (graceful fallback on rate-limit/unreachable/private),
  then runs it through the scrubber + Zod. Other platforms (Slack/Jira/Notion) are pasted text.
- **Voice-to-text exit interviews** â€” microphone buttons on each interview question use the browser
  Web Speech API (`window.SpeechRecognition` / `webkitSpeechRecognition`) with a graceful fallback
  to typing when unsupported.
- **Impeccable audit pass** â€” dark-mode contrast fixes for tier badges, global keyboard focus rings,
  and a responsive slide-over drawer with a click-to-close backdrop.

## 2. Runtime modes

| Mode | When | Notes |
| --- | --- | --- |
| In-memory (default) | `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` not set | Pre-seeded stateful singleton; zero configuration. This is what the live Vercel demo uses. |
| Supabase | Both env vars set | Relational persistence: each entity (sources, claims, conflicts, gaps, next_actions, who_to_ask, handover, audit_log) lives in its own table, with optimistic concurrency via `state_meta`. Requires migrations 001 + 002. Falls back to memory on any error. |

### Environment variables (all optional — demo runs without any)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (enables Supabase persistence) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for PostgREST writes (bypasses RLS server-side) |
| `OPENAI_API_KEY` | Enables the real LLM reconstruction path (OpenAI chat completions, JSON mode) |
| `GEMINI_API_KEY` | LLM provider (Gemini 3.5 Flash, JSON MIME) |
| `GEMINI_MODEL` | Optional model id override (default `gemini-3.5-flash`) |
| `GITHUB_TOKEN` | Optional — attaches to GitHub API calls (60 → 5000 req/hr) |

LLM/github tokens are never required: the engine falls back to the deterministic heuristic on any
LLM failure/timeout (30 s), and GitHub ingestion falls back to the pasted text. Before enabling
Supabase persistence, run `supabase/migrations/001_init_schema.sql` (SQL editor or `supabase db push`)
so the `chronicle_state` table exists. The top-nav badge shows `db · supabase` when connected and
surfaces the underlying error when a connection attempt fails.

## 3. Code map

```
supabase/
  migrations/001_init_schema.sql   # schema + RLS policies (sources, claims, conflicts, gaps, audit_log, handover, chronicle_state)
  seed/synthetic_payments_project.json  # 8 artifacts + gap definitions + facts
src/
  lib/
    types.ts                       # shared domain types + tier/label constants
    schemas/handover-zod.ts        # all Zod schemas (entities + API payloads)
    security/secret-scrubber.ts    # scrubSecrets() + inspectSecrets()
    security/rbac-filter.ts        # filterSourcesByClearance / computeClaimAccessTier / filterClaimsByClearance
    engine/citation-verifier.ts    # verifyClaimCitations / verifyClaims / preflightCitations
    engine/temporal-reconstructor.ts  # heuristicReconstruct + guarded LLM path + deriveWhoToAsk
    engine/heuristic-extractor.ts  # deterministic candidate-fact extraction for custom sources
    engine/handover-export.ts      # Markdown renderer for the locked snapshot packet (+ exit interviews)
    engine/github-ingest.ts        # real GitHub PR fetch (title/body) with graceful fallback
    store/project-store.ts         # ProjectStore singleton: seed, persistence, mutations, viewer filtering
    store/supabase-persistence.ts  # relational Supabase persistence (per-entity + state_meta CAS)
    api/helpers.ts                 # tier header parsing, JSON error envelope, body parsing
    workspace-context.tsx          # client state hub (stage, role, inspector, API actions)
  types/speech.d.ts                # minimal Web Speech API typings (window.SpeechRecognition)
  app/
    layout.tsx / page.tsx / workspace-client.tsx
    api/ingest/route.ts  api/reconstruct/route.ts  api/verify/route.ts  api/handover/route.ts
  components/
    top-nav-stepper.tsx            # 5-stage stepper + role switcher + theme + reset
    stage-connect.tsx              # Stage 01 explorer + ingest form
    stage-reconstruct-verify.tsx   # Stages 02â€“03 timeline + grounding panel
    stage-review.tsx               # Stage 04 conflict resolver + exit interviews
    stage-handover.tsx             # Stage 05 portal + first-7-days + snapshot/receipt + audit
    citation-inspector-drawer.tsx  # slide-over drawer with verbatim highlight
    shared.tsx                     # badges, icons, date helpers
    ui/*                           # shadcn/ui (Base UI) primitives
```

## 4. How the engine works (deterministic path)

1. Each source in the seed JSON has a `facts` array â€” structured extraction hints
   (`category`, `title`, `summary`, `verbatimQuote`, optional `conflictGroup`/`stance`/`gapId`).
2. `heuristicReconstruct()` turns facts into `Claim`s, merging duplicates by
   category+title+stance+gapId and attaching citations (source id + verbatim quote).
3. `detectConflicts()` groups claims by `conflictGroup`; if â‰¥2 stances exist, it picks the
   earliest claim as source A and the latest different-stance claim as source B, recommending the
   newer one. (Gap corroboration is carried in `corroboratingB`.)
4. `buildGaps()` materializes the 3-question exit micro-interviews from `seed.gaps`.
5. `deriveNextActions()` ranks `NEXT_ACTION` + unfinished/gap work into P0/P1/P2 items.
6. `deriveWhoToAsk()` ranks contributor handles by artifact/fact frequency and surfaces their
   CONTACT topics for the handover packet.

The optional LLM path (`GEMINI_API_KEY` / `OPENAI_API_KEY`, 6 s timeout) enriches facts and then
falls back to the deterministic path; the demo never depends on it.

## 5. How verification works

`verifyClaimCitations(claim, sourceMap)`:
- fails a citation if its `source_id` is missing, or its `verbatim_quote` is not a substring of the
  **sanitized** source content (normalized whitespace/case);
- downgrades the claim to `MISSING_EVIDENCE` unless it is already `HUMAN_APPROVED`.
`preflightCitations()` (used at reconstruction) sets flags without touching status.

## 6. How to edit common things

- **Add a source artifact**: append an object to `sources` in
  `supabase/seed/synthetic_payments_project.json`; include `facts` with `verbatimQuote` copied
  verbatim from its `rawContent` (whitespace/case-insensitive match). Rebuild; the store re-seeds
  on server restart. Verify with a GET `/api/reconstruct` call.
- **Add a conflict**: give two facts the same `conflictGroup` but different `stance` values and
  different timestamps. The engine will surface `CONFLICT DETECTED` automatically.
- **Add a gap**: add an entry in the top-level `gaps` array (id, title, description, sourceIds,
  exactly 3 questions, suggestedAnswers) and tag relevant facts with `gapId`.
- **Add a secret pattern**: edit `COMBINED_PATTERN` (+ `classifySecret`) in
  `src/lib/security/secret-scrubber.ts`. Keep patterns non-greedy; avoid catastrophic backtracking.
- **Change the handover packet format**: edit `src/lib/engine/handover-export.ts` (pure function;
  takes the filtered `WorkspaceState` + viewer label).
- **Adjust GitHub ingestion**: `src/lib/engine/github-ingest.ts` owns the URL regex and API call;
  the route merges fetched content before Zod validation. Unauthenticated rate limit is 60 req/hr
  per IP â€” the route degrades to the pasted text with `github.fetched: false`.
- **Voice transcription**: `src/types/speech.d.ts` types `window.SpeechRecognition`; the mic UI
  lives in `stage-review.tsx` (`toggleMicrophone`). Browsers without the API get a toast + typing.
- **Change tiers**: tiers live in `src/lib/types.ts` (`TIER_VALUES`). Viewer tier is derived
  server-side from the signed session cookie (`src/lib/auth/get-viewer.ts`), never from client
  input; filtering happens in `project-store.ts → filterState()`.
- **Change the UI**: stages are separate components in `src/components/stage-*.tsx`, all driven by
  `workspace-context.tsx`. The shadcn/ui primitives in `src/components/ui/*` are Base UI
  (`@base-ui/react`) â€” use `render={<Comp />}` instead of Radix-style `asChild`.
- **Run checks**: `npm run build` (type-check + lint + compile) must pass with zero errors;
  `npm run lint`. Preview with `npm run dev` or `npm run start` after `npm run build`.

## 7. API surface (all JSON; deterministic error envelope `{ error: { code, message, details? } }`)

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/reconstruct` | GET | Current role-filtered workspace state |
| `/api/reconstruct` | POST | Re-run reconstruction (`{"withVerify": true}` also verifies) |
| `/api/ingest` | POST | Scrub â†’ Zod-validate â†’ store source; returns sanitized artifact + redaction stats |
| `/api/verify` | POST | Programmatic quote grounding; returns outcome + state |
| `/api/handover` | GET | Role-filtered handover bundle (snapshot, next actions, audit tail) |
| `/api/handover` | POST | `resolve_conflict` \| `submit_interview` \| `edit_claim` \| `lock_snapshot` \| `acknowledge_receipt` \| `reset_demo` |
| `/api/handover/export` | GET | Markdown packet of the locked snapshot (409 until locked) |

## 8. Known behaviors / gotchas

- The store is a **server-side singleton**; mutations are persisted through `saveSnapshot` after
  every action. On Vercel, memory mode means a fresh deployment starts from the seed again.
- Citation grounding runs against **sanitized** content, so a quote containing a scrubbed secret
  becomes `UNVERIFIED` (deliberate â€” see C-016). C-020 is a plant with a quote absent from its
  source to demonstrate the downgrade rule.
- Stage 02 and 03 share one component; the role switcher refetches state (server-side filter), so
  restricted claims/sources disappear in real time.
- Dates in the seed are ISO 8601 with `Z`; Zod uses `z.string().datetime({ offset: true })`.
