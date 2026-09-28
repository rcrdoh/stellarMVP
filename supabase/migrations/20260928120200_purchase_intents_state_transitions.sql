-- Purchase intent status transition guards (Module 2 remediation, finding M2-4).
--
-- The RLS layer only constrained *which columns* `payment_agent` may update on
-- `purchase_intents`; it did not constrain the lifecycle, so an agent could jump
-- straight from `pending` to `paid` and skip confirmation. This trigger enforces
-- the monotonic lifecycle declared by the table `status` CHECK constraint:
--
--   pending -> approved -> payment_submitted -> paid
--   pending/approved -> cancelled | expired
--   paid | cancelled | expired  (terminal, immutable)
--
-- NOTE (deviation from the eSDD draft): the draft modelled the lifecycle with
-- `pending_confirmation/confirmed/submitted/failed/unknown`, which do not exist
-- in the deployed schema (`pending/approved/payment_submitted/paid/cancelled/
-- expired`). Ingesting those names verbatim would leave every real transition
-- unguarded, so the guard below follows the deployed vocabulary. The function,
-- trigger and failure semantics match the eSDD.
--
-- `BEFORE UPDATE OF status` fires whenever `status` is assigned; the terminal
-- branch compares values, so idempotent same-value writes still succeed.

create or replace function validate_purchase_intent_status_transition()
returns trigger as $$
begin
  if old.status = 'pending' and new.status not in ('approved', 'cancelled', 'expired') then
    raise exception 'Invalid status transition from pending to %', new.status;
  elsif old.status = 'approved' and new.status not in ('payment_submitted', 'cancelled', 'expired') then
    raise exception 'Invalid status transition from approved to %', new.status;
  elsif old.status = 'payment_submitted' and new.status <> 'paid' then
    raise exception 'Invalid status transition from payment_submitted to %', new.status;
  elsif old.status in ('paid', 'cancelled', 'expired') and new.status <> old.status then
    raise exception 'Terminal state % cannot be modified', old.status;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validate_purchase_intent_status on purchase_intents;

create trigger trg_validate_purchase_intent_status
before update of status on purchase_intents
for each row
execute function validate_purchase_intent_status_transition();
