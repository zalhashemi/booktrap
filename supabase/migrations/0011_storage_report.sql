-- BookTrap phase 9: how much room the database uses, per table.
-- Run once in the Supabase SQL Editor after 0010_moderation.sql. Read-only: it creates one function
-- and changes no data. A second run fails ("already exists") and changes nothing.
--
-- storage_report() lists every BookTrap table and the auth tables a reader adds rows to, with exact row
-- counts and sizes (table, indexes, total), plus one "database" row for the whole database, which is
-- what Supabase's plan limit counts (Free: 500 MB). Used to measure the size of one reader's shelf.

begin;

create function public.storage_report()
returns table (table_name text, row_count bigint, total_bytes bigint, index_bytes bigint)
language plpgsql
stable
-- Reads auth tables' sizes and counts, so it runs as its owner; only the API's role may call it.
security definer
set search_path = ''
as $$
declare
  rel record;
begin
  for rel in
    select c.oid, n.nspname, c.relname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and (n.nspname = 'public'
           or (n.nspname = 'auth' and c.relname in ('users', 'identities', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'one_time_tokens')))
    order by n.nspname, c.relname
  loop
    table_name := rel.nspname || '.' || rel.relname;
    execute format('select count(*) from %I.%I', rel.nspname, rel.relname) into row_count;
    total_bytes := pg_catalog.pg_total_relation_size(rel.oid);
    index_bytes := pg_catalog.pg_indexes_size(rel.oid);
    return next;
  end loop;

  table_name := 'database';
  row_count := null;
  total_bytes := pg_catalog.pg_database_size(pg_catalog.current_database());
  index_bytes := null;
  return next;
end;
$$;

revoke all on function public.storage_report() from anon, authenticated, public;
grant execute on function public.storage_report() to service_role;

commit;
