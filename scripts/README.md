# scripts

Automatizacion local para mantener el contrato como fuente de verdad.

- `bun run spec:check`: valida reglas SDD sobre `specs/openapi.json`.
- `validate-openapi.ts`: implementacion del validador de contrato.
- `bun run db:smoke`: aplica todas las migraciones de `supabase/migrations`
  contra una base PostgreSQL real y verifica tablas, triggers y procedimientos
  (cierre del hallazgo M2-1). Requiere `DATABASE_URL` y falla sin abrir conexion
  si la variable esta vacia.
- `migrate-smoke.ts`: implementacion del smoke de migraciones; no forma parte de
  `bun test` porque necesita un motor real.
