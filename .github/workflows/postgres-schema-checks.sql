-- Chronicle — Postgres schema regression checks (run after migrations 001-006).
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

  -- 3. next_actions unique index on (ref, task)
  perform 1 from pg_indexes where schemaname = 'public' and tablename = 'next_actions' and indexname = 'idx_next_actions_ref_task_unique';
  if not found then raise exception 'next_actions (ref,task) unique index missing'; end if;

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

  -- 7. conflicts.access_tier exists
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conflicts' and column_name = 'access_tier';
  if not found then raise exception 'conflicts.access_tier missing'; end if;

  -- 8. gaps access_tier uses MIN semantics: a gap linking a T1 and a T3
  --    source must be tier 1 (visible to a T1 viewer).
  insert into public.sources (id, type, title, author, created_at, access_tier, raw_content, sanitized_content)
    values
      ('SRC-T1', 'SLACK_THREAD', 's', '@a', now(), 1, 'x', 'x'),
      ('SRC-T3', 'NOTION_DOC', 's', '@b', now(), 3, 'x', 'x');
  insert into public.gaps (id, title, description, source_ids, questions, suggested_answers, answers, status, access_tier)
    values ('GAP-TEST', 'g', 'd', '["SRC-T1","SRC-T3"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'MISSING_EVIDENCE', 3);
  update public.gaps g
    set access_tier = coalesce(
      (select min(s.access_tier)
         from jsonb_array_elements_text(g.source_ids) as ids(value)
         join public.sources s on s.id = ids.value),
      3
    )
    where g.id = 'GAP-TEST';
  perform 1 from public.gaps where id = 'GAP-TEST' and access_tier = 1;
  if not found then raise exception 'gaps access_tier not MIN semantics'; end if;

  -- 9. conflicts.access_tier derives from the linked claims (max of both sides)
  insert into public.claims (id, category, title, summary, timestamp, author, access_tier, status, citations)
    values
      ('C-T1', 'DECISION', 'a', 'b', now(), '@a', 1, 'VERIFIED', '[]'::jsonb),
      ('C-T3', 'DECISION', 'a', 'b', now(), '@b', 3, 'VERIFIED', '[]'::jsonb);
  insert into public.conflicts (id, subject, source_a, source_b, corroborating_b, recommendation, resolution, access_tier)
    values ('CT-TEST', 'sub', jsonb_build_object('claimId', 'C-T1'), jsonb_build_object('claimId', 'C-T3'), '[]'::jsonb, 'SOURCE_A', 'UNRESOLVED', 1);
  update public.conflicts c
    set access_tier = (
      select max(cl.access_tier)
        from public.claims cl
        where cl.id in (c.source_a ->> 'claimId', c.source_b ->> 'claimId')
    )
    where c.id = 'CT-TEST';
  perform 1 from public.conflicts where id = 'CT-TEST' and access_tier = 3;
  if not found then raise exception 'conflicts access_tier not derived from claims'; end if;

  -- 10. Round-trip shapes the adapter sends:
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
