-- ============================================================================
-- Chronicle — audit remediation (Round 3.5)
-- Migration 002: relational persistence tables + user-level RLS policies.
--
-- Adds:
--   * per-entity tables for next_actions, who_to_ask, state_meta (optimistic
--     concurrency), plus a `facts` column on sources so candidate facts persist.
--   * RLS INSERT/UPDATE/DELETE policies for the authenticated role on every
--     app-managed entity, so ordinary authenticated tokens (not just the
--     service-role key) can write through PostgREST.
--   * tier-gated SELECT policies for the new tables matching the existing ones.
-- ============================================================================

-- facts column on sources (authored + heuristic candidate facts).
alter table public.sources
  add column if not exists facts jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- next_actions
-- ----------------------------------------------------------------------------
create table if not exists public.next_actions (
  id           bigint generated always as identity primary key,
  task         text not null,
  owner_hint   text,
  priority     text not null check (priority in ('P0','P1','P2')),
  ref          text not null,
  access_tier  integer not null default 2 check (access_tier between 1 and 3),
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- who_to_ask
-- ----------------------------------------------------------------------------
create table if not exists public.who_to_ask (
  id           bigint generated always as identity primary key,
  handle       text not null unique,
  display_name text not null,
  artifact_count integer not null default 0,
  fact_count   integer not null default 0,
  topics       jsonb not null default '[]'::jsonb,
  access_tier  integer not null default 3 check (access_tier between 1 and 3)
);

-- ----------------------------------------------------------------------------
-- state_meta — optimistic concurrency version row for the workspace state.
-- ----------------------------------------------------------------------------
create table if not exists public.state_meta (
  id         text primary key,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_next_actions_tier on public.next_actions (access_tier);
create index if not exists idx_who_to_ask_tier on public.who_to_ask (access_tier);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.next_actions enable row level security;
alter table public.who_to_ask enable row level security;
alter table public.state_meta enable row level security;

-- SELECT (tier-gated, mirroring sources/claims):
create policy "anon can read tier 1 next actions"
  on public.next_actions for select to anon
  using (access_tier <= 1);
create policy "authenticated can read visible next actions"
  on public.next_actions for select to authenticated
  using (access_tier <= public.current_viewer_tier());

create policy "anon can read tier 1 who to ask"
  on public.who_to_ask for select to anon
  using (access_tier <= 1);
create policy "authenticated can read visible who to ask"
  on public.who_to_ask for select to authenticated
  using (access_tier <= public.current_viewer_tier());

create policy "authenticated can read state meta"
  on public.state_meta for select to authenticated
  using (true);
create policy "anon can read state meta"
  on public.state_meta for select to anon
  using (true);

-- WRITE policies for the authenticated role (app-managed entities). The app
-- writes via a user-level token, so each entity needs explicit INSERT/UPDATE/
-- DELETE grants; service-role (server-side hydration) bypasses RLS entirely.
create policy "authenticated can insert sources"
  on public.sources for insert to authenticated with check (true);
create policy "authenticated can update sources"
  on public.sources for update to authenticated using (true) with check (true);

create policy "authenticated can insert claims"
  on public.claims for insert to authenticated with check (true);
create policy "authenticated can update claims"
  on public.claims for update to authenticated using (true) with check (true);
create policy "authenticated can delete claims"
  on public.claims for delete to authenticated using (true);

create policy "authenticated can insert conflicts"
  on public.conflicts for insert to authenticated with check (true);
create policy "authenticated can update conflicts"
  on public.conflicts for update to authenticated using (true) with check (true);
create policy "authenticated can delete conflicts"
  on public.conflicts for delete to authenticated using (true);

create policy "authenticated can insert gaps"
  on public.gaps for insert to authenticated with check (true);
create policy "authenticated can update gaps"
  on public.gaps for update to authenticated using (true) with check (true);
create policy "authenticated can delete gaps"
  on public.gaps for delete to authenticated using (true);

create policy "authenticated can insert next actions"
  on public.next_actions for insert to authenticated with check (true);
create policy "authenticated can update next actions"
  on public.next_actions for update to authenticated using (true) with check (true);
create policy "authenticated can delete next actions"
  on public.next_actions for delete to authenticated using (true);

create policy "authenticated can insert who to ask"
  on public.who_to_ask for insert to authenticated with check (true);
create policy "authenticated can update who to ask"
  on public.who_to_ask for update to authenticated using (true) with check (true);
create policy "authenticated can delete who to ask"
  on public.who_to_ask for delete to authenticated using (true);

create policy "authenticated can insert audit log"
  on public.audit_log for insert to authenticated with check (true);
create policy "authenticated can update audit log"
  on public.audit_log for update to authenticated using (true) with check (true);

create policy "authenticated can update handover"
  on public.handover for update to authenticated using (true) with check (true);
create policy "authenticated can insert handover"
  on public.handover for insert to authenticated with check (true);

create policy "authenticated can upsert state meta"
  on public.state_meta for insert to authenticated with check (true);
create policy "authenticated can update state meta"
  on public.state_meta for update to authenticated using (true) with check (true);
