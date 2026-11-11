-- ============================================================================
-- Chronicle — audit remediation (Round 3.7)
-- Migration 004: schema compatibility fixes for the relational persistence
-- adapter (verified against PostgreSQL 16 with migrations 001-003 applied).
--
-- Fixes:
--   1. claims.superseded column missing (adapter upserts it).
--   2. audit_log.id is uuid but the app generates text ids like `AUD-001`.
--   3. who_to_ask upsert needs `on_conflict=handle` (handled in adapter) —
--      unique constraint already exists from migration 002.
--   4. next_actions has no natural key -> unbounded duplicate rows on every
--      save. Add a unique index on task; the adapter will replace wholesale.
--   5. gaps RLS policies cast source_ids (text ids like `GH-PR-95`) to int,
--      which errors. Add a real access_tier column and rewrite all policies.
--   6. state_meta write policies were tier-blind -> tier-gate to maintainers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. claims.superseded
-- ----------------------------------------------------------------------------
alter table public.claims
  add column if not exists superseded boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. audit_log.id text
-- ----------------------------------------------------------------------------
alter table public.audit_log alter column id drop default;
alter table public.audit_log alter column id type text using id::text;

-- ----------------------------------------------------------------------------
-- 3/4. next_actions: dedupe + unique on task
-- ----------------------------------------------------------------------------
delete from public.next_actions a
  using public.next_actions b
  where a.id > b.id and a.task = b.task;

create unique index if not exists idx_next_actions_task_unique
  on public.next_actions (task);

-- ----------------------------------------------------------------------------
-- 5. gaps: real access_tier column + corrected policies
-- ----------------------------------------------------------------------------
alter table public.gaps
  add column if not exists access_tier integer not null default 3
  check (access_tier between 1 and 3);

update public.gaps g
  set access_tier = coalesce(
    (select max(s.access_tier)
       from jsonb_array_elements_text(g.source_ids) as ids(value)
       join public.sources s on s.id = ids.value),
    3
  );

drop policy if exists "anon can read tier 1 gaps" on public.gaps;
drop policy if exists "authenticated can read visible gaps" on public.gaps;
drop policy if exists "authenticated can insert gaps" on public.gaps;
drop policy if exists "authenticated can update gaps" on public.gaps;
drop policy if exists "authenticated can delete gaps" on public.gaps;

create policy "anon can read tier 1 gaps"
  on public.gaps for select to anon
  using (access_tier <= 1);

create policy "authenticated can read visible gaps"
  on public.gaps for select to authenticated
  using (access_tier <= public.current_viewer_tier());

create policy "authenticated can insert gaps"
  on public.gaps for insert to authenticated
  with check (access_tier <= public.current_viewer_tier());

create policy "authenticated can update gaps"
  on public.gaps for update to authenticated
  using (access_tier <= public.current_viewer_tier())
  with check (access_tier <= public.current_viewer_tier());

create policy "authenticated can delete gaps"
  on public.gaps for delete to authenticated
  using (access_tier <= public.current_viewer_tier());

-- ----------------------------------------------------------------------------
-- 6. state_meta writes: maintainer-only
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can upsert state meta" on public.state_meta;
drop policy if exists "authenticated can update state meta" on public.state_meta;

create policy "authenticated can insert state meta"
  on public.state_meta for insert to authenticated
  with check (public.current_viewer_tier() = 3);

create policy "authenticated can update state meta"
  on public.state_meta for update to authenticated
  using (public.current_viewer_tier() = 3)
  with check (public.current_viewer_tier() = 3);
