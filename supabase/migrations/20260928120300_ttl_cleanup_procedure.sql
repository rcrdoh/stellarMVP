-- TTL cleanup for materialized search results (Module 2 remediation, M2-3).
--
-- `search_results.expires_at` bounds how long a ranked price may be surfaced.
-- Readers treat rows past `expires_at` as stale; this procedure physically
-- removes them so the discovery scope does not retain expired pricing forever.
--
-- Returns the number of deleted rows so a scheduler can log/alert on it. Safe to
-- call repeatedly and intended to run from a cron job or an operator session:
--
--   select purge_expired_search_results();

create or replace function purge_expired_search_results()
returns integer as $$
declare
  deleted_count integer;
begin
  delete from search_results
  where expires_at is not null and expires_at < now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$ language plpgsql;
