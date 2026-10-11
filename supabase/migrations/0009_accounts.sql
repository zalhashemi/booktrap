-- BookTrap phase 7: accounts (Supabase Auth) replace device identity.
-- Run once in the Supabase SQL Editor after 0008_delete_device.sql, with the API stopped.
--
-- Every visitor is a Supabase user: a guest is an anonymous user, and signing up adds an email to that
-- same user, so ownership goes by auth.users(id). Device-owned shelves are DROPPED, not migrated
-- (back them up first with api/scripts/backup-device-shelves.ts). Cached posts, spend history and
-- network counts are kept. Runs in one transaction: a second run fails on the first statement and
-- changes nothing.

begin;

-- Drop the device-owned rows ------------------------------------------------------
-- Books, tags and jobs cascade from devices (and their sources, book tags and items with them);
-- spend_events.device_id is set null, so the monthly budget still counts what was spent.

delete from public.devices;

-- Ownership moves from devices to users ---------------------------------------------

alter table public.books drop constraint books_device_id_fkey;
alter table public.tags drop constraint tags_device_id_fkey;
alter table public.jobs drop constraint jobs_device_id_fkey;
alter table public.job_items drop constraint job_items_device_id_fkey;
alter table public.spend_events drop constraint spend_events_device_id_fkey;

alter table public.books rename column device_id to user_id;
alter table public.tags rename column device_id to user_id;
alter table public.jobs rename column device_id to user_id;
alter table public.job_items rename column device_id to user_id;
alter table public.spend_events rename column device_id to user_id;

alter table public.books
  add constraint books_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.tags
  add constraint tags_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.jobs
  add constraint jobs_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.job_items
  add constraint job_items_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.spend_events
  add constraint spend_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

alter index public.books_device_normalized_key_idx rename to books_user_normalized_key_idx;
alter index public.books_device_isbn13_idx rename to books_user_isbn13_idx;
alter index public.books_device_created_idx rename to books_user_created_idx;
alter index public.books_device_new_idx rename to books_user_new_idx;
alter index public.books_device_live_idx rename to books_user_live_idx;
alter index public.tags_device_name_idx rename to tags_user_name_idx;
alter index public.jobs_device_created_idx rename to jobs_user_created_idx;
alter index public.job_items_device_created_idx rename to job_items_user_created_idx;

-- Device identity is gone ----------------------------------------------------------

drop function public.delete_device(uuid);
drop table public.deleted_devices;
drop table public.devices;  -- takes its devices_refuse_deleted trigger with it
drop function public.refuse_deleted_device();

-- Daily caps, per user ----------------------------------------------------------------
-- Same as 0007/0008 with users in place of devices. The parameter names change, so the old
-- functions are dropped rather than replaced. Locks are still taken user first, then network.

drop function public.add_child_items_capped(uuid, jsonb, integer, integer, timestamptz);
drop function public.create_job_capped(uuid, text, jsonb, integer, integer, integer, timestamptz);
drop function public.posts_since(uuid, text, timestamptz);
drop function public.lock_daily_caps(uuid, text);

create function public.lock_daily_caps(p_user_id uuid, p_ip_hash text) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('booktrap:cap:user:' || p_user_id::text, 0));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('booktrap:cap:ip:' || p_ip_hash, 0));
  end if;
end;
$$;

-- Posts counted against today's caps: every item except a collection link itself (its videos count),
-- plus what deleted accounts read on the network today.
create function public.posts_since(p_user_id uuid, p_ip_hash text, p_since timestamptz,
                                   out by_user integer, out by_ip integer)
language sql stable
set search_path = ''
as $$
  select
    (select count(*)::integer from public.job_items i
      where i.user_id = p_user_id and i.created_at >= p_since
        and (i.kind is null or i.kind <> 'collection')),
    case when p_ip_hash is null then 0 else
      (select count(*)::integer from public.job_items i join public.jobs j on j.id = i.job_id
        where j.ip_hash = p_ip_hash and i.created_at >= p_since
          and (i.kind is null or i.kind <> 'collection'))
      + (select coalesce(sum(u.posts), 0)::integer from public.network_usage u
          where u.ip_hash = p_ip_hash and u.used_at >= p_since)
    end;
$$;

-- Creates a job with its items, or refuses when `p_posts` more would pass a cap.
-- Returns {"job_id": ...} or {"capped": "user" | "ip", "used": n}.
-- p_items: [{"input_url", "source_platform", "source_post_id", "kind"}, ...] in the reader's order.
-- p_user_cap is the caller's: guests get fewer posts a day than signed-in users.
create function public.create_job_capped(
  p_user_id uuid, p_ip_hash text, p_items jsonb, p_posts integer,
  p_user_cap integer, p_ip_cap integer, p_since timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  used record;
  new_job uuid;
begin
  perform public.lock_daily_caps(p_user_id, p_ip_hash);
  select * into used from public.posts_since(p_user_id, p_ip_hash, p_since);
  if used.by_user + p_posts > p_user_cap then
    return jsonb_build_object('capped', 'user', 'used', used.by_user);
  end if;
  if p_ip_hash is not null and used.by_ip + p_posts > p_ip_cap then
    return jsonb_build_object('capped', 'ip', 'used', used.by_ip);
  end if;

  insert into public.jobs (user_id, ip_hash) values (p_user_id, p_ip_hash) returning id into new_job;
  -- A microsecond apart, so items keep the order they were pasted in.
  insert into public.job_items (job_id, user_id, input_url, source_platform, source_post_id, kind, created_at)
  select new_job, p_user_id, item->>'input_url', (item->>'source_platform')::public.source_platform,
         item->>'source_post_id', (item->>'kind')::public.job_item_kind,
         now() + (position * interval '1 microsecond')
  from jsonb_array_elements(p_items) with ordinality as entries(item, position);
  return jsonb_build_object('job_id', new_job);
end;
$$;

-- Adds a collection's videos under it, as many as today's caps still allow (in listing order).
-- Idempotent: if the children already exist (a retry after a lost response), they are returned as they are.
-- p_user_cap is the job owner's cap (the API looks up whether they are a guest).
create function public.add_child_items_capped(
  p_parent_id uuid, p_items jsonb, p_user_cap integer, p_ip_cap integer, p_since timestamptz
) returns setof public.job_items
language plpgsql
set search_path = ''
as $$
declare
  parent record;
  used record;
  room integer;
begin
  select i.id, i.job_id, i.user_id, j.ip_hash into parent
  from public.job_items i join public.jobs j on j.id = i.job_id
  where i.id = p_parent_id;
  if not found then
    raise exception 'job item % not found', p_parent_id;
  end if;

  perform public.lock_daily_caps(parent.user_id, parent.ip_hash);
  if exists (select 1 from public.job_items where parent_item_id = p_parent_id) then
    return query select * from public.job_items where parent_item_id = p_parent_id order by created_at;
    return;
  end if;

  select * into used from public.posts_since(parent.user_id, parent.ip_hash, p_since);
  room := p_user_cap - used.by_user;
  if parent.ip_hash is not null then
    room := least(room, p_ip_cap - used.by_ip);
  end if;
  if room <= 0 then
    return;
  end if;

  return query
  insert into public.job_items (job_id, user_id, parent_item_id, input_url, source_platform, source_post_id, kind, created_at)
  select parent.job_id, parent.user_id, p_parent_id, item->>'input_url',
         (item->>'source_platform')::public.source_platform, item->>'source_post_id',
         (item->>'kind')::public.job_item_kind, now() + (position * interval '1 microsecond')
  from jsonb_array_elements(p_items) with ordinality as entries(item, position)
  where position <= room
  returning *;
end;
$$;

-- Deleting an account ------------------------------------------------------------------
-- Deletes a user's shelf, tags and jobs, carrying the posts their networks read in the last 2 days
-- into network_usage so deleting doesn't reset a network's daily cap. The API then deletes the user
-- through Supabase's admin API (auth.users cascades anything left). Safe to run twice.
create function public.delete_user_data(p_user_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.lock_daily_caps(p_user_id, null);

  insert into public.network_usage (ip_hash, used_at, posts)
  select j.ip_hash, min(i.created_at), count(*)::integer
  from public.job_items i join public.jobs j on j.id = i.job_id
  where j.user_id = p_user_id and j.ip_hash is not null
    and i.created_at >= now() - interval '2 days'
    and (i.kind is null or i.kind <> 'collection')
  group by j.ip_hash, date_trunc('day', i.created_at at time zone 'utc');

  delete from public.jobs where user_id = p_user_id;
  delete from public.books where user_id = p_user_id;
  delete from public.tags where user_id = p_user_id;
  delete from public.user_activity where user_id = p_user_id;
end;
$$;

-- Guests who stop visiting -----------------------------------------------------------
-- Supabase doesn't record a visit when a session is refreshed, so the API notes one here
-- (at most hourly per user). An unclaimed guest shelf is deleted after 30 days without a visit.
create table public.user_activity (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);

-- Anonymous users not seen since p_before (a guest the API never saw counts from when it was created).
-- Reads auth.users, so it runs as its owner; only the API's role may call it.
create function public.inactive_guests(p_before timestamptz, p_limit integer) returns setof uuid
language sql stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u left join public.user_activity a on a.user_id = u.id
  where u.is_anonymous and coalesce(a.last_seen_at, u.created_at) < p_before
  order by coalesce(a.last_seen_at, u.created_at)
  limit p_limit;
$$;

-- Lock everything down -----------------------------------------------------------------

alter table public.user_activity enable row level security;
revoke all on public.user_activity from anon, authenticated;
grant select, insert, update, delete on public.user_activity to service_role;

revoke all on function public.lock_daily_caps(uuid, text) from anon, authenticated, public;
revoke all on function public.posts_since(uuid, text, timestamptz) from anon, authenticated, public;
revoke all on function public.create_job_capped(uuid, text, jsonb, integer, integer, integer, timestamptz) from anon, authenticated, public;
revoke all on function public.add_child_items_capped(uuid, jsonb, integer, integer, timestamptz) from anon, authenticated, public;
revoke all on function public.delete_user_data(uuid) from anon, authenticated, public;
revoke all on function public.inactive_guests(timestamptz, integer) from anon, authenticated, public;
-- The capped functions run with the caller's rights, so the API's role needs the helpers too.
grant execute on function public.lock_daily_caps(uuid, text) to service_role;
grant execute on function public.posts_since(uuid, text, timestamptz) to service_role;
grant execute on function public.create_job_capped(uuid, text, jsonb, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.add_child_items_capped(uuid, jsonb, integer, integer, timestamptz) to service_role;
grant execute on function public.delete_user_data(uuid) to service_role;
grant execute on function public.inactive_guests(timestamptz, integer) to service_role;

commit;
