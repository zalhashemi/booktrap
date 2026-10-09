-- BookTrap change request 001, part 1: there is no "unsure" state any more.
-- Every extracted book is shelved as-is; enrichment (cover, ISBN, year) stays a quiet bonus.
-- Run once in the Supabase SQL Editor after 0003_list.sql.

alter table public.books drop column if exists unsure;
