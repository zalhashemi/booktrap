-- BookTrap phase 4: TikTok collection expansion.
-- Run once in the Supabase SQL Editor after 0005_platforms.sql.

-- A short note for the reader on a finished item, e.g. "Read the first 25 videos of this collection."
alter table public.job_items add column note text check (note is null or length(note) <= 500);

-- Children of a collection are looked up by their parent (resume after a restart, progress).
create index job_items_parent_idx on public.job_items (parent_item_id) where parent_item_id is not null;
