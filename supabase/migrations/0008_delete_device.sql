-- BookTrap phase 7b: "Delete my shelf".
-- Run once in the Supabase SQL Editor after 0007_hardening.sql.

-- A deleted device's random id, so its credentials (or a backup code held elsewhere) can't quietly
-- register it again. Nothing else about the device is kept.
create table public.deleted_devices (
  id          uuid primary key,
  deleted_at  timestamptz not null default now()
);

create function public.refuse_deleted_device() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.deleted_devices where id = new.id) then
    -- Reported like an existing id, so registration answers 409 and the app offers a fresh shelf.
    raise exception 'device % was deleted', new.id using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger devices_refuse_deleted before insert on public.devices
  for each row execute function public.refuse_deleted_device();

-- Posts a deleted device read today still count against its network's daily cap, or deleting and
-- starting over would reset it. Only the keyed network hash and a count are kept, for 2 days.
create table public.network_usage (
  ip_hash  text not null,
  used_at  timestamptz not null,
  posts    integer not null check (posts > 0)
);
create index network_usage_ip_idx on public.network_usage (ip_hash, used_at);

create or replace function public.posts_since(p_device_id uuid, p_ip_hash text, p_since timestamptz,
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
      + (select coalesce(sum(u.posts), 0)::integer from public.network_usage u
          where u.ip_hash = p_ip_hash and u.used_at >= p_since)
    end;
$$;

-- Deletes a device and everything it owns, keeping only its tombstone and its networks' recent counts.
create function public.delete_device(p_device_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.network_usage (ip_hash, used_at, posts)
  select j.ip_hash, min(i.created_at), count(*)::integer
  from public.job_items i join public.jobs j on j.id = i.job_id
  where j.device_id = p_device_id and j.ip_hash is not null
    and i.created_at >= now() - interval '2 days'
    and (i.kind is null or i.kind <> 'collection')
  group by j.ip_hash, date_trunc('day', i.created_at at time zone 'utc');

  insert into public.deleted_devices (id) values (p_device_id) on conflict do nothing;
  delete from public.devices where id = p_device_id;
end;
$$;

alter table public.deleted_devices enable row level security;
alter table public.network_usage enable row level security;
revoke all on public.deleted_devices, public.network_usage from anon, authenticated;
revoke all on function public.refuse_deleted_device() from anon, authenticated, public;
revoke all on function public.delete_device(uuid) from anon, authenticated, public;
grant execute on function public.delete_device(uuid) to service_role;
