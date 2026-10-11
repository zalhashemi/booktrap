-- BookTrap phase 8: moderation, reports and takedown.
-- Run once in the Supabase SQL Editor after 0009_accounts.sql. One transaction: a second run fails on
-- the first statement and changes nothing.
--
-- A post can be skipped (nothing from it is added): the extraction's content check blocks explicit or
-- graphic posts that aren't about books (the verdict lives in post_cache.extracted_json), and a takedown
-- puts a post on removed_posts, which never expires (the post cache does, after 90 days). Readers report
-- posts from their own shelf; the operator takes posts down from the admin page or a script.

begin;

-- Why a job item added nothing: explicit, graphic, refused (Claude declined) or removed (taken down).
alter table public.job_items
  add column blocked text check (blocked in ('explicit', 'graphic', 'refused', 'removed'));

-- Posts that are never read or shown again, whoever pastes them.
create table public.removed_posts (
  source_platform  public.source_platform not null,
  source_post_id   text not null,
  -- report: from the admin page's queue; request: a removal request (email); admin: the operator's own call.
  reason           text not null check (reason in ('report', 'request', 'admin')),
  source_url       text,
  creator_handle   text,
  removed_at       timestamptz not null default now(),
  primary key (source_platform, source_post_id)
);

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  -- Kept when the reporter deletes their account: the report is about the post, not them.
  user_id          uuid references auth.users (id) on delete set null,
  source_platform  public.source_platform not null,
  source_post_id   text not null,
  source_url       text not null,
  creator_handle   text,
  reason           text not null check (reason in ('explicit', 'graphic', 'hateful', 'mine', 'other')),
  note             text check (char_length(note) <= 500),
  status           text not null default 'open' check (status in ('open', 'taken_down', 'dismissed')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  check (reason <> 'other' or note is not null)
);
-- One open report per reader per post: reporting it again is a no-op.
create unique index reports_open_once_idx on public.reports (user_id, source_platform, source_post_id) where status = 'open';
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_post_idx on public.reports (source_platform, source_post_id);
create index reports_user_created_idx on public.reports (user_id, created_at desc);

-- Finding every shelf a post is on (takedown, reports). The unique key leads with book_id.
create index book_sources_post_idx on public.book_sources (source_platform, source_post_id);

-- A removed post doesn't count against the daily caps once it's been skipped ----------------
-- Same as 0009 apart from leaving out items blocked as removed (they cost nothing).
create or replace function public.posts_since(p_user_id uuid, p_ip_hash text, p_since timestamptz,
                                              out by_user integer, out by_ip integer)
language sql stable
set search_path = ''
as $$
  select
    (select count(*)::integer from public.job_items i
      where i.user_id = p_user_id and i.created_at >= p_since
        and (i.kind is null or i.kind <> 'collection')
        and i.blocked is distinct from 'removed'),
    case when p_ip_hash is null then 0 else
      (select count(*)::integer from public.job_items i join public.jobs j on j.id = i.job_id
        where j.ip_hash = p_ip_hash and i.created_at >= p_since
          and (i.kind is null or i.kind <> 'collection')
          and i.blocked is distinct from 'removed')
      + (select coalesce(sum(u.posts), 0)::integer from public.network_usage u
          where u.ip_hash = p_ip_hash and u.used_at >= p_since)
    end;
$$;

-- How far a post reached: shelves with it, books seen only in it, and how many of those the reader
-- changed (status, notes or shelves), which a takedown keeps.
create function public.post_reach(p_platform public.source_platform, p_post_id text,
                                  out shelves integer, out only_here integer, out edited integer)
language sql stable
set search_path = ''
as $$
  with target as (
    select b.id, b.user_id, b.status, b.notes
    from public.book_sources s join public.books b on b.id = s.book_id
    where s.source_platform = p_platform and s.source_post_id = p_post_id
  ), lonely as (
    select t.*,
           (t.status <> 'want_to_read' or t.notes is not null
            or exists (select 1 from public.book_tags bt where bt.book_id = t.id)) as changed
    from target t
    where not exists (
      select 1 from public.book_sources o
      where o.book_id = t.id and not (o.source_platform = p_platform and o.source_post_id = p_post_id)
    )
  )
  select (select count(distinct user_id)::integer from target),
         (select count(*)::integer from lonely),
         (select count(*)::integer from lonely where changed);
$$;

-- Takes a post down everywhere (user decision, 2026-10-11): it goes on removed_posts, its cached
-- reading is deleted, it stops being a source on every shelf, books seen only in it are deleted unless
-- the reader changed them (those stay, without the source), and its reports are closed.
-- Returns {"sources_removed", "books_deleted", "books_kept"}. Safe to run twice.
create function public.take_down_post(p_platform public.source_platform, p_post_id text, p_reason text,
                                      p_url text, p_handle text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  untouched uuid[];
  deleted integer;
  kept integer;
  removed integer;
begin
  insert into public.removed_posts (source_platform, source_post_id, reason, source_url, creator_handle)
  values (p_platform, p_post_id, p_reason, p_url, p_handle)
  on conflict (source_platform, source_post_id) do nothing;

  delete from public.post_cache where source_platform = p_platform and source_post_id = p_post_id;

  -- Books with no other source: untouched ones go (with this source, by cascade), changed ones stay.
  select coalesce(array_agg(lonely.id) filter (where not lonely.changed), '{}'),
         count(*) filter (where lonely.changed)::integer
  into untouched, kept
  from (
    select b.id,
           (b.status <> 'want_to_read' or b.notes is not null
            or exists (select 1 from public.book_tags bt where bt.book_id = b.id)) as changed
    from public.book_sources s join public.books b on b.id = s.book_id
    where s.source_platform = p_platform and s.source_post_id = p_post_id
      and not exists (
        select 1 from public.book_sources o
        where o.book_id = b.id and not (o.source_platform = p_platform and o.source_post_id = p_post_id)
      )
  ) lonely;

  delete from public.books where id = any (untouched);
  get diagnostics deleted = row_count;

  delete from public.book_sources where source_platform = p_platform and source_post_id = p_post_id;
  get diagnostics removed = row_count;

  -- Dismissed reports close too: the post was taken down after all.
  update public.reports set status = 'taken_down', resolved_at = now()
  where source_platform = p_platform and source_post_id = p_post_id and status in ('open', 'dismissed');

  return jsonb_build_object('sources_removed', removed + deleted, 'books_deleted', deleted, 'books_kept', kept);
end;
$$;

-- Finished jobs are kept 30 days (the app shows the last few; today's caps only need today's).
create function public.purge_old_jobs(p_before timestamptz) returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.jobs where created_at < p_before and status in ('done', 'failed') returning 1
  )
  select count(*)::integer from gone;
$$;

-- Lock everything down -----------------------------------------------------------------

alter table public.removed_posts enable row level security;
alter table public.reports enable row level security;
revoke all on public.removed_posts from anon, authenticated;
revoke all on public.reports from anon, authenticated;
grant select, insert, update, delete on public.removed_posts to service_role;
grant select, insert, update, delete on public.reports to service_role;

revoke all on function public.post_reach(public.source_platform, text) from anon, authenticated, public;
revoke all on function public.take_down_post(public.source_platform, text, text, text, text) from anon, authenticated, public;
revoke all on function public.purge_old_jobs(timestamptz) from anon, authenticated, public;
grant execute on function public.post_reach(public.source_platform, text) to service_role;
grant execute on function public.take_down_post(public.source_platform, text, text, text, text) to service_role;
grant execute on function public.purge_old_jobs(timestamptz) to service_role;

commit;
