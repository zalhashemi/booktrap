-- 0012: the admin page's Stats view (Phase 10, option B "Tiles and chart").
--
-- admin_stats(p_range, p_tz) returns one JSON document of counts and totals for the last 7 days, the last
-- 30 days or this month, in the operator's time zone: readers, posts read (per day, paid reads against
-- free cache hits), failures, this month's spend against the budget, the most-shelved books and the
-- database size. Counts only: no reader's shelf or links. Reads auth.users, so it runs as its owner; only
-- the API's role may call it.

begin;

-- Whether a finished post came from the post cache (free) rather than being read new. Written by the API
-- when the item finishes; null on items finished before this migration (the stats then look for spend).
alter table public.job_items add column if not exists from_cache boolean;

-- Spend is looked up by item; posts are counted by when they were pasted.
create index if not exists spend_events_item_idx on public.spend_events (job_item_id) where job_item_id is not null;
create index if not exists job_items_created_idx on public.job_items (created_at);

create function public.admin_stats(p_range text, p_tz text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- A zone Postgres doesn't know (the browser's list can be newer) falls back to UTC.
  v_tz text := case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
  v_today date := (pg_catalog.now() at time zone v_tz)::date;
  v_from date;
  v_since timestamptz;
  -- Finished jobs are deleted after 30 days (purge_old_jobs), so posts can't be counted further back.
  v_kept timestamptz := pg_catalog.now() - interval '30 days';
  -- The monthly budget counts the UTC month (the API's spend limit), so the spend figures do too.
  v_month timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  v_month_end timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  v_result jsonb;
begin
  v_from := case p_range
    when '7d' then v_today - 6
    when '30d' then v_today - 29
    when 'month' then pg_catalog.date_trunc('month', pg_catalog.now() at time zone v_tz)::date
  end;
  if v_from is null then
    raise exception 'unknown range %', p_range using errcode = '22023';
  end if;
  v_since := v_from::timestamp at time zone v_tz;

  with items as (
    -- Posts, not the collection rows that only list them.
    select ji.id, ji.status, ji.error, ji.source_platform, ji.created_at,
           case
             when ji.from_cache is not null then not ji.from_cache
             else exists (select 1 from public.spend_events s where s.job_item_id = ji.id and s.provider = 'anthropic')
           end as paid
    from public.job_items ji
    where ji.created_at >= v_since and ji.kind is distinct from 'collection'
  )
  select jsonb_build_object(
    'timeZone', v_tz,
    'from', v_from,
    'today', v_today,
    -- True when the range reaches back past what's kept: its first days are missing posts.
    'clipped', v_since < v_kept,
    'monthStart', v_month,
    'monthEnd', v_month_end,
    'now', pg_catalog.now(),
    'readers', (
      select jsonb_build_object(
        'total', count(*),
        'accounts', count(*) filter (where not coalesce(u.is_anonymous, false)),
        'guests', count(*) filter (where coalesce(u.is_anonymous, false)),
        'newInRange', count(*) filter (where u.created_at >= v_since))
      from auth.users u),
    'active7d', (select count(*) from public.user_activity where last_seen_at >= pg_catalog.now() - interval '7 days'),
    'posts', (
      select jsonb_build_object(
        'done', count(*) filter (where status = 'done'),
        'paid', count(*) filter (where status = 'done' and paid),
        'failed', count(*) filter (where status = 'failed'),
        'tiktok', count(*) filter (where status in ('done', 'failed') and source_platform = 'tiktok'),
        'instagram', count(*) filter (where status in ('done', 'failed') and source_platform = 'instagram'))
      from items),
    'perDay', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'paid', paid, 'cached', cached) order by day), '[]'::jsonb)
      from (
        select (created_at at time zone v_tz)::date as day,
               count(*) filter (where status = 'done' and paid) as paid,
               count(*) filter (where status = 'done' and not paid) as cached
        from items group by 1
      ) d),
    'topFailures', (
      select coalesce(jsonb_agg(jsonb_build_object('error', error, 'count', n) order by n desc, error), '[]'::jsonb)
      from (
        select error, count(*) as n from items where status = 'failed' and error is not null
        group by error order by n desc, error limit 3
      ) f),
    -- What the posts read new in the range cost (their own spend rows), for the average per new post.
    'paidPostsSpend', (
      select coalesce(sum(s.usd), 0)
      from public.spend_events s join items i on i.id = s.job_item_id
      where i.status = 'done' and i.paid),
    'spendMonth', (
      select jsonb_build_object(
        'anthropic', coalesce(sum(usd) filter (where provider = 'anthropic'), 0),
        'apify', coalesce(sum(usd) filter (where provider = 'apify'), 0))
      from public.spend_events
      where created_at >= v_month),
    'topBooks', (
      select coalesce(jsonb_agg(jsonb_build_object('title', title, 'author', author, 'shelves', shelves) order by shelves desc, title), '[]'::jsonb)
      from (
        -- Title and author from the same row (the first shelved), not mixed across readers' copies.
        select (pg_catalog.array_agg(b.title order by b.created_at, b.id))[1] as title,
               (pg_catalog.array_agg(b.author order by b.created_at, b.id))[1] as author,
               count(distinct b.user_id) as shelves
        from public.books b
        where b.deleted_at is null and b.created_at >= v_since
        group by b.normalized_key
        order by 3 desc, 1
        limit 5
      ) t),
    'databaseBytes', pg_catalog.pg_database_size(pg_catalog.current_database())
  )
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_stats(text, text) from anon, authenticated, public;
grant execute on function public.admin_stats(text, text) to service_role;

commit;
