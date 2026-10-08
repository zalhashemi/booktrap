-- BookTrap phase 3: list experience.
-- Run once in the Supabase SQL Editor after 0002_pipeline.sql.

-- Soft delete, so "Delete" can be undone for a while (brief §7: multi-select delete with undo).
alter table public.books add column deleted_at timestamptz;
create index books_device_live_idx on public.books (device_id, created_at desc) where deleted_at is null;

-- Tag names are compared case-insensitively per device (unique index from 0001); keep them tidy.
alter table public.tags add constraint tags_name_trimmed check (name = btrim(name));

-- Purges books deleted more than 30 days ago. Called opportunistically by the API.
create function public.purge_deleted_books() returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.books where deleted_at < now() - interval '30 days' returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.purge_deleted_books() from anon, authenticated, public;
grant execute on function public.purge_deleted_books() to service_role;
