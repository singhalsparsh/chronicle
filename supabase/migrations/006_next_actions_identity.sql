-- ============================================================================
-- Chronicle — audit remediation (Round 3.9)
-- Migration 006: next_actions identity.
--
-- The unique index created in migration 004 used `task` alone, which rejects
-- two distinct actions that share a task text but differ in `ref` (e.g. two
-- "Unblock: …" tasks from different claims). Use `(ref, task)` instead, which
-- matches the semantic identity of a derived action.
-- ============================================================================

delete from public.next_actions a
  using public.next_actions b
  where a.id > b.id and a.ref = b.ref and a.task = b.task;

drop index if exists idx_next_actions_task_unique;

create unique index if not exists idx_next_actions_ref_task_unique
  on public.next_actions (ref, task);
