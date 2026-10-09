-- BookTrap change request 001, part 2: posts can come from TikTok or Instagram.
-- Source columns become platform-neutral: source_platform + source_post_id + source_url.
-- Existing rows are all TikTok. Run once in the Supabase SQL Editor after 0004_remove_unsure.sql.

create type public.source_platform as enum ('tiktok', 'instagram');

-- Book sources ------------------------------------------------------------------

alter table public.book_sources add column source_platform public.source_platform not null default 'tiktok';
alter table public.book_sources alter column source_platform drop default;
alter table public.book_sources rename column tiktok_post_id to source_post_id;
alter table public.book_sources rename column tiktok_url to source_url;
alter table public.book_sources drop constraint book_sources_book_id_tiktok_post_id_key;
alter table public.book_sources
  add constraint book_sources_book_post_key unique (book_id, source_platform, source_post_id);

-- Paid-fetch cache: keyed by platform + post id ---------------------------------

alter table public.post_cache add column source_platform public.source_platform not null default 'tiktok';
alter table public.post_cache alter column source_platform drop default;
alter table public.post_cache rename column tiktok_post_id to source_post_id;
alter table public.post_cache drop constraint post_cache_pkey;
alter table public.post_cache add primary key (source_platform, source_post_id);

-- Job items ---------------------------------------------------------------------

alter table public.job_items add column source_platform public.source_platform not null default 'tiktok';
alter table public.job_items alter column source_platform drop default;
alter table public.job_items rename column resolved_post_id to source_post_id;
create index job_items_post_idx on public.job_items (source_platform, source_post_id) where source_post_id is not null;
