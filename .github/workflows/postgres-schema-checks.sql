-- Chronicle — Postgres schema regression checks (run after migrations 001-004).
-- Exits non-zero via RAISE EXCEPTION if any assertion fails.
do $$
begin
  -- 1. claims.superseded exists
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'claims' and column_name = 'superseded';
  if not found then raise exception 'claims.superseded missing'; end if;

  -- 2. audit_log.id is text
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_log' and column_name = 'id' and data_type = 'text';
  if not found then raise exception 'audit_log.id is not text'; end if;

  -- 3. next_actions unique index on task
  perform 1 from pg_indexes where schemaname = 'public' and tablename = 'next_actions' and indexname = 'idx_next_actions_task_unique';
  if not found then raise exception 'next_actions unique index missing'; end if;

  -- 4. gaps.access_tier exists
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gaps' and column_name = 'access_tier';
  if not found then raise exception 'gaps.access_tier missing'; end if;

  -- 5. state_meta write policies are tier-gated (no with-check true remaining)
  perform 1 from pg_policies
    where schemaname = 'public' and tablename = 'state_meta' and cmd in ('INSERT','UPDATE')
      and with_check ~ 'current_viewer_tier';
  if not found then raise exception 'state_meta write policies not tier-gated'; end if;

  -- 6. gaps policies no longer reference the broken int cast
  perform 1 from pg_policies
    where schemaname = 'public' and tablename = 'gaps' and permissive
      and (qual ~ 'jsonb_array_elements_text' or with_check ~ 'jsonb_array_elements_text');
  if found then raise exception 'gaps policies still cast source_ids'; end if;

  -- Round-trip shapes the adapter sends:
  insert into public.claims (id, category, title, summary, timestamp, author, access_tier, status, superseded, citations)
    values ('C-TEST', 'DECISION', 't', 's', now(), '@a', 3, 'VERIFIED', true, '[]'::jsonb);

  insert into public.audit_log (id, ts, actor, action, detail)
    values ('AUD-001', now(), 'System', 'APP_LOADED', 'probe');

  delete from public.next_actions;
  insert into public.next_actions (task, owner_hint, priority, ref, access_tier)
    values ('T1', '@a', 'P0', 'C-TEST', 3);
  begin
    insert into public.next_actions (task, owner_hint, priority, ref, access_tier)
      values ('T1', '@a', 'P0', 'C-TEST', 3);
    raise exception 'duplicate next_actions insert should have failed';
  exception when unique_violation then
    null;
  end;

  raise notice 'POSTGRES SCHEMA CHECKS PASSED';
end $$;
