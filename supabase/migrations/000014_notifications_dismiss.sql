-- 000014: let customers clear notifications (kept in the database until the nightly cleanup, so "Undo" works).
begin;

alter table public.notifications add column if not exists dismissed_at timestamptz;

create index if not exists notifications_user_visible_idx
  on public.notifications (user_id, created_at desc) where dismissed_at is null;

-- The existing policy already limits updates to the customer's own rows; this only allows the new column.
grant update (dismissed_at) on public.notifications to authenticated;

commit;
