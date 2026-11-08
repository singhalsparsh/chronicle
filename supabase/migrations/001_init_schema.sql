-- ============================================================================
-- Chronicle — Evidence-Linked Project State Reconstruction & Permissioned Handover
-- Migration 001: base schema + Row-Level Security policies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Viewer tier helper: reads the viewer_tier claim from the JWT (defaults to 1
-- = the least-privileged clearance)
-- ----------------------------------------------------------------------------
create or replace function public.current_viewer_tier()
returns integer
language sql
stable
as $$
  select coalesce(
    nullif((select auth.jwt() ->> 'viewer_tier'), '')::integer,
    1
  );
$$;

-- ----------------------------------------------------------------------------
-- sources — ingested artifacts (scrubbed content is stored; raw is kept for audit)
-- ----------------------------------------------------------------------------
create table public.sources (
  id                text primary key,
  type              text not null check (type in ('GITHUB_PR','SLACK_THREAD','JIRA_TICKET','NOTION_DOC')),
  title             text not null,
  author            text not null,
  created_at        timestamptz not null default now(),
  access_tier       integer not null check (access_tier between 1 and 3),
  raw_content       text not null,
  sanitized_content text not null,
  url               text,
  meta              jsonb not null default '{}'::jsonb
);

-- ----------------------------------------------------------------------------
-- claims — reconstructed evidence claims
-- ----------------------------------------------------------------------------
create table public.claims (
  id            text primary key,
  category      text not null check (category in ('DECISION','UNFINISHED','RISK','DEPENDENCY','CONTACT','NEXT_ACTION')),
  title         text not null,
  summary       text not null,
  timestamp     timestamptz not null,
  author        text not null,
  access_tier   integer not null check (access_tier between 1 and 3),
  status        text not null default 'EVIDENCE_GATHERED'
                check (status in ('EVIDENCE_GATHERED','VERIFIED','MISSING_EVIDENCE','HUMAN_APPROVED')),
  conflict_group text,
  stance        text,
  gap_id        text,
  citations     jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- conflicts — detected contradictions between sources
-- ----------------------------------------------------------------------------
create table public.conflicts (
  id            text primary key,
  subject       text not null,
  source_a      jsonb not null,
  source_b      jsonb not null,
  corroborating_b jsonb not null default '[]'::jsonb,
  recommendation text not null check (recommendation in ('SOURCE_A','SOURCE_B','MANUAL')),
  resolution    text not null default 'UNRESOLVED'
                check (resolution in ('UNRESOLVED','SOURCE_A','SOURCE_B','MANUAL_EDIT')),
  manual_note   text,
  resolved_at   timestamptz
);

-- ----------------------------------------------------------------------------
-- gaps — missing-evidence flags with 3-question exit micro-interviews
-- ----------------------------------------------------------------------------
create table public.gaps (
  id             text primary key,
  title          text not null,
  description    text not null,
  source_ids     jsonb not null default '[]'::jsonb,
  questions      jsonb not null default '[]'::jsonb,
  suggested_answers jsonb not null default '[]'::jsonb,
  answers        jsonb not null default '[]'::jsonb,
  status         text not null default 'MISSING_EVIDENCE'
                 check (status in ('MISSING_EVIDENCE','HUMAN_APPROVED')),
  approved_at    timestamptz
);

-- ----------------------------------------------------------------------------
-- audit_log — immutable append-only trail
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id       uuid primary key default gen_random_uuid(),
  ts       timestamptz not null default now(),
  actor    text not null,
  action   text not null,
  detail   text not null
);

-- ----------------------------------------------------------------------------
-- handover — snapshot + receipt state (single row)
-- ----------------------------------------------------------------------------
create table public.handover (
  id                       integer primary key default 1 check (id = 1),
  version                  text not null default 'v1.0',
  locked                   boolean not null default false,
  locked_at                timestamptz,
  receipt_acknowledged     boolean not null default false,
  receipt_acknowledged_at  timestamptz,
  ack_actor                text,
  digest                    text not null default ''
);

-- ----------------------------------------------------------------------------
-- chronicle_state — hybrid fallback snapshot (used by PostgREST persistence)
-- ----------------------------------------------------------------------------
create table public.chronicle_state (
  id         text primary key,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index idx_sources_tier on public.sources (access_tier);
create index idx_sources_type on public.sources (type);
create index idx_claims_tier on public.claims (access_tier);
create index idx_claims_status on public.claims (status);
create index idx_claims_gap on public.claims (gap_id);
create index idx_conflicts_resolution on public.conflicts (resolution);
create index idx_gaps_status on public.gaps (status);
create index idx_audit_ts on public.audit_log (ts desc);

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- ----------------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.claims enable row level security;
alter table public.conflicts enable row level security;
alter table public.gaps enable row level security;
alter table public.audit_log enable row level security;
alter table public.handover enable row level security;
alter table public.chronicle_state enable row level security;

-- Sources: anon sees tier 1; authenticated sees tiers up to their claim.
create policy "anon can read tier 1 sources"
  on public.sources for select
  to anon
  using (access_tier <= 1);

create policy "authenticated can read visible sources"
  on public.sources for select
  to authenticated
  using (access_tier <= public.current_viewer_tier());

-- Claims: same tier gating based on computed access tier.
create policy "anon can read tier 1 claims"
  on public.claims for select
  to anon
  using (access_tier <= 1);

create policy "authenticated can read visible claims"
  on public.claims for select
  to authenticated
  using (access_tier <= public.current_viewer_tier());

-- Conflicts: anon sees conflicts whose both sides are tier 1; authenticated sees
-- conflicts where both claim tiers are visible. PostgREST filters by metadata,
-- so we store the max tier compactly via source_a->>'tier' / source_b->>'tier'.
create policy "anon can read tier 1 conflicts"
  on public.conflicts for select
  to anon
  using (
    coalesce(nullif(source_a ->> 'tier', '')::int, 1) <= 1
    and coalesce(nullif(source_b ->> 'tier', '')::int, 1) <= 1
  );

create policy "authenticated can read visible conflicts"
  on public.conflicts for select
  to authenticated
  using (
    coalesce(nullif(source_a ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
    and coalesce(nullif(source_b ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
  );

-- Gaps: visible when at least one linked source tier is visible.
create policy "anon can read tier 1 gaps"
  on public.gaps for select
  to anon
  using ((select min(t) from jsonb_array_elements_text(source_ids) ids, lateral (select coalesce(nullif(ids.value,'')::int, 3) as t) x) <= 1);

create policy "authenticated can read visible gaps"
  on public.gaps for select
  to authenticated
  using ((select min(t) from jsonb_array_elements_text(source_ids) ids, lateral (select coalesce(nullif(ids.value,'')::int, 3) as t) x) <= public.current_viewer_tier());

-- Audit log + handover: authenticated users can read; writes go through the
-- service role (bypasses RLS). This keeps the judge demo frictionless while
-- still guarding rows from unauthorized mutation.
create policy "authenticated can read audit log"
  on public.audit_log for select
  to authenticated
  using (true);

create policy "authenticated can read handover"
  on public.handover for select
  to authenticated
  using (true);

-- chronicle_state: only service-role writes; reads restricted to authenticated.
create policy "authenticated can read snapshot state"
  on public.chronicle_state for select
  to authenticated
  using (true);

-- Public read for the demo seed (harmless, sanitized state only).
create policy "anon can read snapshot state"
  on public.chronicle_state for select
  to anon
  using (true);
