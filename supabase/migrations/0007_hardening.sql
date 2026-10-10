-- BookTrap phase 7: hardening.
-- Run once in the Supabase SQL Editor after 0006_collections.sql.

-- Daily caps, enforced atomically ------------------------------------------------
-- Counting posts and inserting them used to be two separate requests, so parallel submissions
-- (or two collections expanding at once on one network) could each pass the check and overshoot
-- the caps. These functions take a per-device and a per-network lock, count, and insert in one
-- transaction. Locks are always taken device first, then network, so they can't deadlock.

create function public.lock_daily_caps(p_device_id uuid, p_ip_hash text) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('booktrap:cap:device:' || p_device_id::text, 0));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('booktrap:cap:ip:' || p_ip_hash, 0));
  end if;
end;
$$;

-- Posts counted against today's caps: every item except a collection link itself (its videos count).
create function public.posts_since(p_device_id uuid, p_ip_hash text, p_since timestamptz,
                                   out by_device integer, out by_ip integer)
language sql stable
set search_path = ''
as $$
  select
    (select count(*)::integer from public.job_items i
      where i.device_id = p_device_id and i.created_at >= p_since
        and (i.kind is null or i.kind <> 'collection')),
    case when p_ip_hash is null then 0 else
      (select count(*)::integer from public.job_items i join public.jobs j on j.id = i.job_id
        where j.ip_hash = p_ip_hash and i.created_at >= p_since
          and (i.kind is null or i.kind <> 'collection'))
    end;
$$;

-- Creates a job with its items, or refuses when `p_posts` more would pass a cap.
-- Returns {"job_id": ...} or {"capped": "device" | "ip", "used": n}.
-- p_items: [{"input_url", "source_platform", "source_post_id", "kind"}, ...] in the reader's order.
create function public.create_job_capped(
  p_device_id uuid, p_ip_hash text, p_items jsonb, p_posts integer,
  p_device_cap integer, p_ip_cap integer, p_since timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  used record;
  new_job uuid;
begin
  perform public.lock_daily_caps(p_device_id, p_ip_hash);
  select * into used from public.posts_since(p_device_id, p_ip_hash, p_since);
  if used.by_device + p_posts > p_device_cap then
    return jsonb_build_object('capped', 'device', 'used', used.by_device);
  end if;
  if p_ip_hash is not null and used.by_ip + p_posts > p_ip_cap then
    return jsonb_build_object('capped', 'ip', 'used', used.by_ip);
  end if;

  insert into public.jobs (device_id, ip_hash) values (p_device_id, p_ip_hash) returning id into new_job;
  -- A microsecond apart, so items keep the order they were pasted in.
  insert into public.job_items (job_id, device_id, input_url, source_platform, source_post_id, kind, created_at)
  select new_job, p_device_id, item->>'input_url', (item->>'source_platform')::public.source_platform,
         item->>'source_post_id', (item->>'kind')::public.job_item_kind,
         now() + (position * interval '1 microsecond')
  from jsonb_array_elements(p_items) with ordinality as entries(item, position);
  return jsonb_build_object('job_id', new_job);
end;
$$;

-- Adds a collection's videos under it, as many as today's caps still allow (in listing order).
-- Idempotent: if the children already exist (a retry after a lost response), they are returned as they are.
create function public.add_child_items_capped(
  p_parent_id uuid, p_items jsonb, p_device_cap integer, p_ip_cap integer, p_since timestamptz
) returns setof public.job_items
language plpgsql
set search_path = ''
as $$
declare
  parent record;
  used record;
  room integer;
begin
  select i.id, i.job_id, i.device_id, j.ip_hash into parent
  from public.job_items i join public.jobs j on j.id = i.job_id
  where i.id = p_parent_id;
  if not found then
    raise exception 'job item % not found', p_parent_id;
  end if;

  perform public.lock_daily_caps(parent.device_id, parent.ip_hash);
  if exists (select 1 from public.job_items where parent_item_id = p_parent_id) then
    return query select * from public.job_items where parent_item_id = p_parent_id order by created_at;
    return;
  end if;

  select * into used from public.posts_since(parent.device_id, parent.ip_hash, p_since);
  room := p_device_cap - used.by_device;
  if parent.ip_hash is not null then
    room := least(room, p_ip_cap - used.by_ip);
  end if;
  if room <= 0 then
    return;
  end if;

  return query
  insert into public.job_items (job_id, device_id, parent_item_id, input_url, source_platform, source_post_id, kind, created_at)
  select parent.job_id, parent.device_id, p_parent_id, item->>'input_url',
         (item->>'source_platform')::public.source_platform, item->>'source_post_id',
         (item->>'kind')::public.job_item_kind, now() + (position * interval '1 microsecond')
  from jsonb_array_elements(p_items) with ordinality as entries(item, position)
  where position <= room
  returning *;
end;
$$;

revoke all on function public.lock_daily_caps(uuid, text) from anon, authenticated, public;
revoke all on function public.posts_since(uuid, text, timestamptz) from anon, authenticated, public;
revoke all on function public.create_job_capped(uuid, text, jsonb, integer, integer, integer, timestamptz) from anon, authenticated, public;
revoke all on function public.add_child_items_capped(uuid, jsonb, integer, integer, timestamptz) from anon, authenticated, public;
-- The capped functions run with the caller's rights, so the API's role needs the helpers too.
grant execute on function public.lock_daily_caps(uuid, text) to service_role;
grant execute on function public.posts_since(uuid, text, timestamptz) to service_role;
grant execute on function public.create_job_capped(uuid, text, jsonb, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.add_child_items_capped(uuid, jsonb, integer, integer, timestamptz) to service_role;

-- Keep less scraped data ---------------------------------------------------------
-- The cache never needed a post's caption (only its books, link, creator and thumbnail): drop it.
update public.post_cache set post = post - 'caption' where post ? 'caption';

-- The API expires cache rows by fetched_at and clears jobs.ip_hash once the day's caps no longer need it.
create index post_cache_fetched_idx on public.post_cache (fetched_at);
create index jobs_created_ip_idx on public.jobs (created_at) where ip_hash is not null;
