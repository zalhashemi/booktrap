-- BookTrap initial schema (brief §9).
--
-- Access model: the browser never talks to the database. Only the API service connects,
-- using the service-role (secret) key, which bypasses RLS. RLS is enabled on every
-- table with NO policies, so the anon/publishable key can read or write nothing.
--
-- Run once in the Supabase SQL Editor (or with `supabase db push`).

create extension if not exists pgcrypto;

-- Devices ---------------------------------------------------------------------

create table public.devices (
  id            uuid primary key,
  secret_hash   text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- Books -----------------------------------------------------------------------

create type public.book_status as enum ('want_to_read', 'reading', 'read');

create table public.books (
  id              uuid primary key default gen_random_uuid(),
  device_id       uuid not null references public.devices (id) on delete cascade,
  title           text not null check (length(title) between 1 and 500),
  author          text check (author is null or length(author) <= 300),
  isbn10          text check (isbn10 is null or isbn10 ~ '^[0-9]{9}[0-9X]$'),
  isbn13          text check (isbn13 is null or isbn13 ~ '^[0-9]{13}$'),
  cover_url       text,
  published_year  smallint check (published_year is null or published_year between 0 and 2200),
  status          public.book_status not null default 'want_to_read',
  verified        boolean not null default false,
  unsure          boolean not null default false,
  is_new          boolean not null default true,
  notes           text check (notes is null or length(notes) <= 5000),
  normalized_key  text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Dedup lookups (brief §9). Not unique: a manual merge resolves edge cases.
create index books_device_normalized_key_idx on public.books (device_id, normalized_key);
create index books_device_isbn13_idx on public.books (device_id, isbn13) where isbn13 is not null;
create index books_device_created_idx on public.books (device_id, created_at desc);
create index books_device_new_idx on public.books (device_id) where is_new;

create table public.book_sources (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.books (id) on delete cascade,
  tiktok_post_id  text not null,
  tiktok_url      text not null,
  creator_handle  text,
  thumbnail_url   text,
  evidence        text check (evidence in ('cover', 'spine', 'text_overlay', 'caption', 'spoken', 'other')),
  confidence      real check (confidence between 0 and 1),
  created_at      timestamptz not null default now(),
  unique (book_id, tiktok_post_id)
);

create index book_sources_book_idx on public.book_sources (book_id);

-- Tags ------------------------------------------------------------------------

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null references public.devices (id) on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

create unique index tags_device_name_idx on public.tags (device_id, lower(name));

create table public.book_tags (
  book_id  uuid not null references public.books (id) on delete cascade,
  tag_id   uuid not null references public.tags (id) on delete cascade,
  primary key (book_id, tag_id)
);

create index book_tags_tag_idx on public.book_tags (tag_id);

-- Jobs ------------------------------------------------------------------------

create type public.job_status as enum ('queued', 'running', 'done', 'failed');
create type public.job_item_status as enum ('queued', 'fetching', 'extracting', 'verifying', 'done', 'failed');
create type public.job_item_kind as enum ('video', 'carousel', 'collection', 'collection_child');

create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices (id) on delete cascade,
  status      public.job_status not null default 'queued',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index jobs_device_created_idx on public.jobs (device_id, created_at desc);
-- Unfinished jobs are resumed when the API wakes (free hosting sleeps).
create index jobs_unfinished_idx on public.jobs (created_at) where status in ('queued', 'running');

create table public.job_items (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  parent_item_id    uuid references public.job_items (id) on delete cascade,
  input_url         text not null,
  resolved_post_id  text,
  kind              public.job_item_kind,
  status            public.job_item_status not null default 'queued',
  error             text,
  books_found       integer not null default 0 check (books_found >= 0),
  attempts          smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index job_items_job_idx on public.job_items (job_id);
create index job_items_unfinished_idx on public.job_items (status)
  where status in ('queued', 'fetching', 'extracting', 'verifying');

-- Paid-fetch cache, shared across devices (brief §4: never pay twice for one post).
create table public.post_cache (
  tiktok_post_id  text primary key,
  extracted_json  jsonb not null,
  fetched_at      timestamptz not null default now()
);

-- Keep updated_at honest --------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger books_touch before update on public.books
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();
create trigger job_items_touch before update on public.job_items
  for each row execute function public.touch_updated_at();

-- Lock everything down -----------------------------------------------------------

alter table public.devices      enable row level security;
alter table public.books        enable row level security;
alter table public.book_sources enable row level security;
alter table public.tags         enable row level security;
alter table public.book_tags    enable row level security;
alter table public.jobs         enable row level security;
alter table public.job_items    enable row level security;
alter table public.post_cache   enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on function public.touch_updated_at() from anon, authenticated, public;

-- Supabase grants anon/authenticated on objects created later by default. Turn that off,
-- so a future table that forgets RLS still isn't reachable with the public key.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
