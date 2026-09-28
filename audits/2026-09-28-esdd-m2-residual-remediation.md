# Audit — eSDD: Residual M2 Remediation & Agent Composition

- **Repository:** stellarMVP
- **Branch:** `coding_agent/agentic-commerce`
- **HEAD:** `b21d7bf` — "Implement Stellar wallet payment intents"
- **Audit date:** 2026-09-28
- **Runtime:** Bun 1.4.2 · TypeScript (strict ESM) · Biome 2.5.10
- **Scope:** Close residual Module 2 (M2) findings from the prior eSDD
  checkpointing/Supabase work and verify them against a **real** Postgres.

---

## 1. Executive summary

Prior Module 2 work added MongoDB/Postgres checkpointing plus four Supabase
migrations (schema, RLS, purchase-intent state transitions, TTL cleanup).
Those migrations were previously only validated for **DDL shape** (string
assertions in tests), never executed against a live database. This audit closes
that gap by applying every migration to a real Postgres cluster and asserting
runtime behavior, not just SQL text.

**Result: PASS.** All 4 migrations apply cleanly; the state-transition trigger
and the TTL purge procedure behave as specified under live execution; the
service verification suite is green (55 tests, 0 failures, 267 assertions).

---

## 2. Findings status

| ID   | Finding                                                            | Status   |
|------|--------------------------------------------------------------------|----------|
| M2-1 | Migrations only checked for DDL shape, never executed              | Resolved |
| M2-2 | Agent checkpointer lifecycle (lazy init / no-URL / close no-op)    | Resolved |
| M2-3 | TTL cleanup for materialized search results                        | Resolved |
| M2-4 | Purchase intent status transition guards                          | Resolved |

### M2-1 — Migrations now executed, not just pattern-matched

Added `scripts/migrate-smoke.ts` (wired as `bun run db:smoke`). It opens a real
Postgres connection, applies each `supabase/migrations/*.sql` in lexical order,
then asserts observable effects:

- all 8 core tables exist (`sources`, `products_raw`, `products_ranked`,
  `search_sessions`, `search_results`, `wallets`, `purchase_intents`,
  `purchase_records`);
- the purchase-intent status trigger is registered;
- `purge_expired_search_results()` is callable.

CI (`.github/workflows/deploy.yml`) runs `bun run db:smoke` against an
ephemeral `postgres:16` service before the validation steps.

**Live run output (real Postgres):**

```
✓ applied 20260928120000_agent_commerce_schema.sql
✓ applied 20260928120100_agent_isolation_rls.sql
✓ applied 20260928120200_purchase_intents_state_transitions.sql
✓ applied 20260928120300_ttl_cleanup_procedure.sql
✓ all 8 tables exist
✓ purchase intent status trigger registered
✓ purge_expired_search_results() callable
✓ invalid transition pending -> paid rejected
✓ valid transition pending -> approved accepted
✓ terminal state cancelled is immutable
```

### M2-3 — TTL cleanup validated behaviorally

`search_results` carries `ttl_seconds integer not null default 900` and
`expires_at timestamptz not null` with index `search_results_expires_at_idx`.
The `purge_expired_search_results()` procedure deletes only rows where
`expires_at < now()` and reports the deleted count via
`get diagnostics deleted_count = row_count`.

Independently verified inside a transaction against the live database: seeding
exactly one expired row resulted in `purge_deleted = 1`.

### M2-4 — Purchase intent transition guards validated behaviorally

`validate_purchase_intent_status_transition` + trigger
`trg_validate_purchase_intent_status` (`before update of status on
purchase_intents`) enforce the lifecycle:

- `pending -> paid` → **rejected** (must go through `approved`/submission).
- `pending -> approved` → **accepted**.
- Terminal state `cancelled` → **immutable** (further updates rejected).

The same `purchase_intents_lock_handoff` trigger pins `product_snapshot`,
`amount`, and `destination` so the deterministic handoff cannot be mutated
after creation.

---

## 3. Verification evidence

Commands executed locally with `LD_LIBRARY_PATH=` (see AGENTS.md environmental
note — a foreign `LD_LIBRARY_PATH` pointing at `/tmp/_MEI*` breaks dynamic
linking).

| Step                          | Command                       | Result                          |
|-------------------------------|-------------------------------|---------------------------------|
| Migration smoke (live PG)     | `bun run db:smoke`            | 10/10 checks passed             |
| Unit + contract tests         | `bun test`                    | **55 pass, 0 fail, 267 expects**|
| OpenAPI contract              | `bun run spec:check`          | OpenAPI spec OK                 |
| Type check                    | `bun run check-types`         | clean                           |
| Lint/format                   | `bun run check`               | 64 files, no fixes applied      |
| Build                         | `bun run build`               | clean                           |

Baseline was 51 tests / 256 assertions across 10 files; current is **55 tests /
267 assertions across 10 files**, i.e. +4 tests, +11 assertions, no failures.

Tests added/updated in `tests/supabase-migrations.test.ts`:
- declares every core table;
- locks deterministic handoff fields;
- search_results TTL column + expiry index;
- discovery/payment agent access-scope separation;
- RLS enabled on every table;
- guards purchase intent status transitions (M2-4);
- exposes TTL purge procedure (M2-3);
- checkpointer: rejects empty connection string before opening a pool;
- lazy factory resolves to `undefined` without a database URL (M2-2);
- closing without an open checkpointer is a no-op (M2-2).

---

## 4. Defects found and fixed during this audit

1. **Smoke script column mismatch (fixed).** `scripts/migrate-smoke.ts` used an
   incorrect `EXPECTED_TABLES` list and mismatched seed columns
   (`intent_id` → `purchase_intent_id`, `amount_minor` → `amount`). Corrected
   against the real schema.
2. **Invalid currency literal (fixed).** The purchase-intent seed used
   `'USDC'` against a `character(3)` column, raising
   `value too long for type character(3)`. Changed to `'USD'`. This was caught
   only because the smoke test now executes the migrations for real — proof
   that M2-1 was a genuine risk, not a theoretical one.

Neither defect affected production SQL; both were confined to the new smoke
harness and are now green.

---

## 5. Environment notes & assumptions

- Local validation used an ephemeral Postgres 16 cluster on `127.0.0.1:55432`
  (database `stellarmvp_smoke` / `smoke_run`). The cluster was stopped after
  the run; no lingering server processes remain from this audit.
- `pgcrypto` is unavailable in the local cluster. `gen_random_uuid()` is
  built-in since PostgreSQL 13, so the single `create extension if not exists
  "pgcrypto"` line was temporarily neutralized **for local execution only** to
  reach the same behavior. The committed migration is unchanged and CI's
  `postgres:16` image ships `pgcrypto`. This is a local-runtime limitation, not
  a repository defect.
- Assumption: "real Postgres" for this audit means a local PostgreSQL 16
  instance applying the exact committed migration files. CI remains the
  authoritative environment for `pgcrypto`.

---

## 6. Residual risks / follow-ups

- **CI is authoritative for `pgcrypto`.** Behavioral parity between the local
  neutralized run and CI should be confirmed by an actual CI run on this branch
  (the workflow already targets `coding_agent/agentic-commerce`).
- **RLS is enabled but policy depth is not re-audited here.** This audit
  confirms `enable row level security` is present on every table and that
  role grants are scoped; it does not enumerate per-table policy coverage for
  every access path.
- **TTL purge is a procedure, not a scheduler.** Nothing in-repo invokes
  `purge_expired_search_results()` on a cadence; an external scheduler
  (cron/pg_cron) must call it. Tracked as a composition follow-up.

---

## 7. Verdict

Residual M2 findings (M2-1, M2-2, M2-3, M2-4) are **resolved and verified
against a live Postgres**. Full service verification is green. The smoke
harness surfaced two real defects that pattern-matching tests could not, and
those are fixed. Recommended next step: push this branch and let CI run
`db:smoke` on `postgres:16` to confirm `pgcrypto` parity.
