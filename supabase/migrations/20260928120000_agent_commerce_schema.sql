-- Agentic commerce core schema (Module 2).
--
-- Durable Postgres data layer backing the discovery and payment agents. Applied
-- via Supabase migrations; every statement is idempotent so re-running the
-- migration set is safe.

create extension if not exists "pgcrypto";

-- Provenance for scraped products. Created first because `products_raw`
-- references it.
create table if not exists sources (
  source_id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  kind text not null default 'merchant'
    check (kind in ('merchant', 'catalog', 'feed')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name)
);

-- Raw scraper output. Append-only; `sources` owns the "where did this come from"
-- provenance. Ranking reads from here and writes `products_ranked`.
create table if not exists products_raw (
  product_raw_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  external_id text not null,
  title text not null,
  description text,
  price_amount numeric(20, 7),
  price_currency char(3),
  destination_country char(2),
  in_stock boolean not null default true,
  attributes jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);

-- Ranked projection the discovery agent presents to shoppers. Kept separate
-- from products_raw so re-ranking never mutates provenance data.
create table if not exists products_ranked (
  product_ranked_id uuid primary key default gen_random_uuid(),
  product_raw_id uuid not null unique references products_raw(product_raw_id) on delete cascade,
  rank_score numeric(12, 6) not null,
  rank_position integer not null check (rank_position > 0),
  rationale text,
  ranked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists products_ranked_position_idx
  on products_ranked (rank_position);

-- Discovery agent session. Owned exclusively by the discovery agent role.
create table if not exists search_sessions (
  session_id uuid primary key default gen_random_uuid(),
  principal_id text not null,
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists search_sessions_principal_idx
  on search_sessions (principal_id, created_at desc);

-- Materialized search results with a TTL. `expires_at` bounds how long a price
-- may be surfaced; readers must treat rows past `expires_at` as stale. The
-- partial index below keeps TTL sweeps cheap.
create table if not exists search_results (
  search_result_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references search_sessions(session_id) on delete cascade,
  product_ranked_id uuid not null references products_ranked(product_ranked_id) on delete cascade,
  price_snapshot jsonb not null,
  currency char(3) not null,
  ttl_seconds integer not null default 900 check (ttl_seconds > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  unique (session_id, product_ranked_id)
);

create index if not exists search_results_session_idx
  on search_results (session_id);
create index if not exists search_results_expires_at_idx
  on search_results (expires_at);

-- Stellar wallet registry. Payment-sensitive; never exposed to discovery.
create table if not exists wallets (
  wallet_id uuid primary key default gen_random_uuid(),
  principal_id text not null,
  address text not null,
  network text not null default 'testnet' check (network in ('testnet', 'public')),
  label text,
  created_at timestamptz not null default now(),
  unique (network, address)
);

-- Deterministic backend handoff. The shopper-approved snapshot, amount and
-- destination are immutable once written: the CHECK constraints below reject
-- any attempt to persist an intent without a locked snapshot, and the guard
-- trigger rejects later mutation of the locked fields.
create table if not exists purchase_intents (
  purchase_intent_id uuid primary key default gen_random_uuid(),
  session_id uuid references search_sessions(session_id) on delete set null,
  principal_id text not null,
  wallet_id uuid not null references wallets(wallet_id),
  product_snapshot jsonb not null,
  amount numeric(20, 7) not null check (amount > 0),
  destination text not null,
  currency char(3) not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'payment_submitted', 'paid', 'cancelled', 'expired')),
  idempotency_key text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(product_snapshot) = 'object'),
  check (length(destination) > 0),
  unique (principal_id, idempotency_key)
);

create index if not exists purchase_intents_pending_idx
  on purchase_intents (status)
  where status = 'pending';

-- Snapshot immutability guard for the locked handoff fields.
create or replace function purchase_intents_lock_handoff()
returns trigger
language plpgsql
as $$
begin
  if new.product_snapshot is distinct from old.product_snapshot
     or new.amount is distinct from old.amount
     or new.destination is distinct from old.destination
     or new.currency is distinct from old.currency then
    raise exception 'purchase_intents handoff fields are immutable'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists purchase_intents_lock_handoff_trg on purchase_intents;
create trigger purchase_intents_lock_handoff_trg
  before update on purchase_intents
  for each row
  execute function purchase_intents_lock_handoff();

-- Immutable settlement record written by the payment agent.
create table if not exists purchase_records (
  purchase_record_id uuid primary key default gen_random_uuid(),
  purchase_intent_id uuid not null unique references purchase_intents(purchase_intent_id),
  wallet_id uuid not null references wallets(wallet_id),
  amount numeric(20, 7) not null check (amount > 0),
  currency char(3) not null,
  destination text not null,
  transaction_hash text not null unique,
  ledger bigint,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
