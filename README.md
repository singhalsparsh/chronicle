# Chronicle

Evidence-linked project state reconstruction and permissioned handover. Chronicle rebuilds the
true state of a software project from its raw artifacts (GitHub PRs, Slack threads, Jira tickets,
Notion docs) and produces a role-filtered, auditable handover for the incoming owner.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, and shadcn/ui.

## What it does

- Reconstructs decisions, unfinished work, risks, dependencies, contacts, and first-7-days next
  actions from evidence, chronologically.
- Verifies every citation as a verbatim substring of its source; unverifiable claims drop to
  MISSING_EVIDENCE.
- Detects contradictions between sources and lets reviewers resolve them live.
- Scrubs secrets (API keys, tokens, DB URIs, emails) on ingest, before anything is stored.
- Applies role-based tier filtering (T1 contractor / T2 engineer / T3 maintainer) server-side.
- Exports the locked snapshot as a Markdown handover packet.

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No environment variables are required: the
app runs on a pre-seeded store out of the box.

Optional setups, each independent:

- **Supabase persistence** — set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and run
  `supabase/migrations/001_init_schema.sql` in your project. The workspace snapshot then survives
  refreshes and cold starts.
- **LLM reconstruction** — set `GEMINI_API_KEY` (default model `gemini-3.5-flash`, override with
  `GEMINI_MODEL`) or `OPENAI_API_KEY`. If the model fails or times out, the dashboard falls back
  to the deterministic engine.
- **GitHub ingestion** — set `GITHUB_TOKEN` to raise the public API rate limit for live PR pulls.

See `.env.example` for the full list.

## Docs

- `doc.md` — Round 2/3 submission documentation with a judge walkthrough.
- `read.md` — orientation for agents and future maintainers.

## Scripts

```bash
npm run build    # type-check + compile
npm run lint     # eslint
npm run dev      # dev server
```
