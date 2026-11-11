-- ============================================================================
-- Chronicle — audit remediation (Round 3.8)
-- Migration 005: correct tier semantics in RLS.
--
-- 1. gaps.access_tier: migration 004 backfilled with MAX of referenced source
--    tiers, which INVERTS the documented visibility rule ("visible when at
--    least one linked source tier is visible", i.e. MIN). Recompute as MIN.
--
-- 2. conflicts: the RLS policies added in 001/003 read `source_a ->> 'tier'`
--    / `source_b ->> 'tier'`, but the adapter stores source objects without a
--    `tier` key ({ sourceId, claimId, value, quote }) — so the cast is always
--    NULL and coalesces to 1, making every conflict appear tier 1. Add a real
--    `access_tier` column derived from the two claims and rewrite all conflict
--    policies (select + write) to use it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. gaps: MIN semantics
-- ----------------------------------------------------------------------------
update public.gaps g
  set access_tier = coalesce(
    (select min(s.access_tier)
       from jsonb_array_elements_text(g.source_ids) as ids(value)
       join public.sources s on s.id = ids.value),
    3
  )
  where true;

-- ----------------------------------------------------------------------------
-- 2. conflicts: real tier column
-- ----------------------------------------------------------------------------
alter table public.conflicts
  add column if not exists access_tier integer not null default 1
  check (access_tier between 1 and 3);

update public.conflicts c
  set access_tier = (
    select max(cl.access_tier)
      from public.claims cl
      where cl.id in (c.source_a ->> 'claimId', c.source_b ->> 'claimId')
  )
  where true;

drop policy if exists "anon can read tier 1 conflicts" on public.conflicts;
drop policy if exists "authenticated can read visible conflicts" on public.conflicts;
drop policy if exists "authenticated can insert conflicts" on public.conflicts;
drop policy if exists "authenticated can update conflicts" on public.conflicts;
drop policy if exists "authenticated can delete conflicts" on public.conflicts;

create policy "anon can read tier 1 conflicts"
  on public.conflicts for select to anon
  using (access_tier <= 1);

create policy "authenticated can read visible conflicts"
  on public.conflicts for select to authenticated
  using (access_tier <= public.current_viewer_tier());

create policy "authenticated can insert conflicts"
  on public.conflicts for insert to authenticated
  with check (access_tier <= public.current_viewer_tier());

create policy "authenticated can update conflicts"
  on public.conflicts for update to authenticated
  using (access_tier <= public.current_viewer_tier())
  with check (access_tier <= public.current_viewer_tier());

create policy "authenticated can delete conflicts"
  on public.conflicts for delete to authenticated
  using (access_tier <= public.current_viewer_tier());
