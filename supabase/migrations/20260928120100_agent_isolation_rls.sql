-- Row Level Security and agent isolation (Module 2).
--
-- Two agent roles are granted strictly disjoint database scopes:
--   * discovery_agent: catalog + search tables only. No wallet, no settlement.
--   * payment_agent:   pending intents + settlement only. No catalog/scraping.
--
-- Both roles are NOLOGIN group roles; the runtime authenticates as its own
-- login role and `set role`s into the appropriate group, so a compromised
-- discovery credential can never read or write wallets/purchase_records.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'discovery_agent') then
    create role discovery_agent nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'payment_agent') then
    create role payment_agent nologin;
  end if;
end
$$;

-- Enable RLS everywhere. Policies are the only path in once RLS is on; the
-- table owner still bypasses RLS, so runtime roles must not own these tables.
alter table sources            enable row level security;
alter table products_raw       enable row level security;
alter table products_ranked    enable row level security;
alter table search_sessions    enable row level security;
alter table search_results     enable row level security;
alter table wallets            enable row level security;
alter table purchase_intents   enable row level security;
alter table purchase_records   enable row level security;

-- Force RLS for table owners too, so the isolation holds even if a runtime
-- connection happens to be the owner in a dev database.
alter table sources            force row level security;
alter table products_raw       force row level security;
alter table products_ranked    force row level security;
alter table search_sessions    force row level security;
alter table search_results     force row level security;
alter table wallets            force row level security;
alter table purchase_intents   force row level security;
alter table purchase_records   force row level security;

-- ---------------------------------------------------------------------------
-- discovery_agent: read catalog, write its own sessions and results.
-- ---------------------------------------------------------------------------

grant select on sources, products_raw, products_ranked to discovery_agent;
grant select, insert, update on search_sessions, search_results to discovery_agent;

-- Explicitly deny payment scope. Revoking from PUBLIC is defensive; the role
-- never receives these grants in the first place.
revoke all on wallets, purchase_records from discovery_agent;

drop policy if exists discovery_read_catalog on sources;
create policy discovery_read_catalog on sources
  for select to discovery_agent using (enabled);

drop policy if exists discovery_read_products_raw on products_raw;
create policy discovery_read_products_raw on products_raw
  for select to discovery_agent using (true);

drop policy if exists discovery_read_products_ranked on products_ranked;
create policy discovery_read_products_ranked on products_ranked
  for select to discovery_agent using (true);

drop policy if exists discovery_insert_sessions on search_sessions;
create policy discovery_insert_sessions on search_sessions
  for insert to discovery_agent with check (true);

drop policy if exists discovery_update_sessions on search_sessions;
create policy discovery_update_sessions on search_sessions
  for update to discovery_agent using (true) with check (true);

drop policy if exists discovery_insert_results on search_results;
create policy discovery_insert_results on search_results
  for insert to discovery_agent with check (true);

drop policy if exists discovery_update_results on search_results;
create policy discovery_update_results on search_results
  for update to discovery_agent using (true) with check (true);

-- ---------------------------------------------------------------------------
-- payment_agent: read pending intents, write settlement records.
-- ---------------------------------------------------------------------------

grant select on purchase_intents to payment_agent;
grant select on wallets to payment_agent;
grant select, insert on purchase_records to payment_agent;
grant update (status, updated_at) on purchase_intents to payment_agent;

-- Explicitly deny catalog/scraping scope.
revoke all on sources, products_raw, products_ranked, search_sessions, search_results
  from payment_agent;

drop policy if exists payment_read_pending_intents on purchase_intents;
create policy payment_read_pending_intents on purchase_intents
  for select to payment_agent using (status = 'pending');

drop policy if exists payment_advance_intents on purchase_intents;
create policy payment_advance_intents on purchase_intents
  for update to payment_agent using (status = 'pending') with check (true);

drop policy if exists payment_read_wallets on wallets;
create policy payment_read_wallets on wallets
  for select to payment_agent using (true);

drop policy if exists payment_insert_records on purchase_records;
create policy payment_insert_records on purchase_records
  for insert to payment_agent with check (true);

drop policy if exists payment_read_records on purchase_records;
create policy payment_read_records on purchase_records
  for select to payment_agent using (true);
