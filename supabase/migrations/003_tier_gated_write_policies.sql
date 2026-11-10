-- ============================================================================
-- Chronicle — audit remediation (Round 3.6)
-- Migration 003: tier-gated WRITE policies.
--
-- Migration 002 granted authenticated-role INSERT/UPDATE/DELETE with
-- `using (true)` / `with check (true)` on every app-managed entity. That made
-- the policies effectively unrestricted: any authenticated token (e.g. a T1
-- contractor token) could write a T3 source or claim.
--
-- This migration replaces those policies with tier-gated ones: an authenticated
-- token may only write rows whose `access_tier` is <= its own viewer tier
-- (read from the PostgREST request JWT via `current_viewer_tier()`).
--
-- NOTE: the app server writes via the service-role key, which bypasses RLS
-- entirely (RLS is defense-in-depth, never the primary boundary). These
-- policies matter for direct client-side PostgREST access and for any future
-- user-level token path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sources
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert sources" on public.sources;
drop policy if exists "authenticated can update sources" on public.sources;
create policy "authenticated can insert sources"
  on public.sources for insert to authenticated
  with check (access_tier <= public.current_viewer_tier());
create policy "authenticated can update sources"
  on public.sources for update to authenticated
  using (access_tier <= public.current_viewer_tier())
  with check (access_tier <= public.current_viewer_tier());

-- ----------------------------------------------------------------------------
-- claims
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert claims" on public.claims;
drop policy if exists "authenticated can update claims" on public.claims;
drop policy if exists "authenticated can delete claims" on public.claims;
create policy "authenticated can insert claims"
  on public.claims for insert to authenticated
  with check (access_tier <= public.current_viewer_tier());
create policy "authenticated can update claims"
  on public.claims for update to authenticated
  using (access_tier <= public.current_viewer_tier())
  with check (access_tier <= public.current_viewer_tier());
create policy "authenticated can delete claims"
  on public.claims for delete to authenticated
  using (access_tier <= public.current_viewer_tier());

-- ----------------------------------------------------------------------------
-- conflicts
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert conflicts" on public.conflicts;
drop policy if exists "authenticated can update conflicts" on public.conflicts;
drop policy if exists "authenticated can delete conflicts" on public.conflicts;
create policy "authenticated can insert conflicts"
  on public.conflicts for insert to authenticated
  with check (
    coalesce(nullif(source_a ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
    and coalesce(nullif(source_b ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
  );
create policy "authenticated can update conflicts"
  on public.conflicts for update to authenticated
  using (
    coalesce(nullif(source_a ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
    and coalesce(nullif(source_b ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
  )
  with check (
    coalesce(nullif(source_a ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
    and coalesce(nullif(source_b ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
  );
create policy "authenticated can delete conflicts"
  on public.conflicts for delete to authenticated
  using (
    coalesce(nullif(source_a ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
    and coalesce(nullif(source_b ->> 'tier', '')::int, 1) <= public.current_viewer_tier()
  );

-- ----------------------------------------------------------------------------
-- gaps (tier is derived from referenced source ids; writing requires the
-- highest referenced tier to be visible)
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert gaps" on public.gaps;
drop policy if exists "authenticated can update gaps" on public.gaps;
drop policy if exists "authenticated can delete gaps" on public.gaps;
create policy "authenticated can insert gaps"
  on public.gaps for insert to authenticated
  with check (
    (select min(t) from jsonb_array_elements_text(source_ids) ids, lateral (select coalesce(nullif(ids.value,'')::int, 3) as t) x)
    <= public.current_viewer_tier()
  );
create policy "authenticated can update gaps"
  on public.gaps for update to authenticated
  using (
    (select min(t) from jsonb_array_elements_text(source_ids) ids, lateral (select coalesce(nullif(ids.value,'')::int, 3) as t) x)
    <= public.current_viewer_tier()
  )
  with check (
    (select min(t) from jsonb_array_elements_text(source_ids) ids, lateral (select coalesce(nullif(ids.value,'')::int, 3) as t) x)
    <= public.current_viewer_tier()
  );
create policy "authenticated can delete gaps"
  on public.gaps for delete to authenticated
  using (
    (select min(t) from jsonb_array_elements_text(source_ids) ids, lateral (select coalesce(nullif(ids.value,'')::int, 3) as t) x)
    <= public.current_viewer_tier()
  );

-- ----------------------------------------------------------------------------
-- next_actions
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert next actions" on public.next_actions;
drop policy if exists "authenticated can update next actions" on public.next_actions;
drop policy if exists "authenticated can delete next actions" on public.next_actions;
create policy "authenticated can insert next actions"
  on public.next_actions for insert to authenticated
  with check (access_tier <= public.current_viewer_tier());
create policy "authenticated can update next actions"
  on public.next_actions for update to authenticated
  using (access_tier <= public.current_viewer_tier())
  with check (access_tier <= public.current_viewer_tier());
create policy "authenticated can delete next actions"
  on public.next_actions for delete to authenticated
  using (access_tier <= public.current_viewer_tier());

-- ----------------------------------------------------------------------------
-- who_to_ask (always tier 3 data; only maintainers may write)
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert who to ask" on public.who_to_ask;
drop policy if exists "authenticated can update who to ask" on public.who_to_ask;
drop policy if exists "authenticated can delete who to ask" on public.who_to_ask;
create policy "authenticated can insert who to ask"
  on public.who_to_ask for insert to authenticated
  with check (public.current_viewer_tier() = 3);
create policy "authenticated can update who to ask"
  on public.who_to_ask for update to authenticated
  using (public.current_viewer_tier() = 3)
  with check (public.current_viewer_tier() = 3);
create policy "authenticated can delete who to ask"
  on public.who_to_ask for delete to authenticated
  using (public.current_viewer_tier() = 3);

-- ----------------------------------------------------------------------------
-- handover (snapshot lifecycle is maintainer-only)
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can update handover" on public.handover;
drop policy if exists "authenticated can insert handover" on public.handover;
create policy "authenticated can insert handover"
  on public.handover for insert to authenticated
  with check (public.current_viewer_tier() = 3);
create policy "authenticated can update handover"
  on public.handover for update to authenticated
  using (public.current_viewer_tier() = 3)
  with check (public.current_viewer_tier() = 3);

-- ----------------------------------------------------------------------------
-- audit_log (append-only; any authenticated user may insert, none may update)
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated can insert audit log" on public.audit_log;
drop policy if exists "authenticated can update audit log" on public.audit_log;
create policy "authenticated can insert audit log"
  on public.audit_log for insert to authenticated
  with check (true);
