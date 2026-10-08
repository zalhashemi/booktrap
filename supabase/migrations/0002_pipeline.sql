-- BookTrap phase 2: single-link pipeline support.
-- Run once in the Supabase SQL Editor after 0001_init.sql.

-- Per-device and per-IP daily caps (brief §4, §11). The IP is stored only as a keyed hash.
alter table public.jobs add column ip_hash text;
alter table public.jobs add column cleared_new boolean not null default false;
create index jobs_ip_created_idx on public.jobs (ip_hash, created_at) where ip_hash is not null;

alter table public.job_items add column device_id uuid references public.devices (id) on delete cascade;
update public.job_items i set device_id = j.device_id from public.jobs j where j.id = i.job_id and i.device_id is null;
alter table public.job_items alter column device_id set not null;
create index job_items_device_created_idx on public.job_items (device_id, created_at);

-- What we learned about a post besides its books (creator, thumbnail, caption), so a cache hit
-- can still attach a full source without paying for the scraper again.
alter table public.post_cache add column post jsonb;
alter table public.post_cache add column model text;

-- Spend ledger for the monthly budget and the kill switch (brief §11).
create table public.spend_events (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid references public.devices (id) on delete set null,
  job_item_id  uuid references public.job_items (id) on delete set null,
  provider     text not null check (provider in ('apify', 'anthropic')),
  usd          numeric(12, 6) not null check (usd >= 0),
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index spend_events_created_idx on public.spend_events (created_at);

create function public.spend_since(since timestamptz) returns numeric
language sql stable
set search_path = ''
as $$
  select coalesce(sum(usd), 0) from public.spend_events where created_at >= since;
$$;

alter table public.spend_events enable row level security;
revoke all on public.spend_events from anon, authenticated;
revoke all on function public.spend_since(timestamptz) from anon, authenticated, public;
grant execute on function public.spend_since(timestamptz) to service_role;
