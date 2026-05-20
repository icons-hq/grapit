\set ON_ERROR_STOP on
\pset pager off

-- Phase 26 dedicated test-event cleanup execution.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v performanceId="$PHASE26_TEST_PERFORMANCE_ID" \
--     -v showtimeId="$PHASE26_TEST_SHOWTIME_ID" \
--     -v orderPrefix="$PHASE26_TEST_ORDER_PREFIX" \
--     -v testMarker="$PHASE26_TEST_MARKER" \
--     -v backupConfirmation="PHASE26_BACKUP_RESTORE_POINT_CONFIRMED" \
--     -v dryRunReviewed="PHASE26_DRY_RUN_REVIEWED" \
--     -v ownerApproval="PHASE26_OWNER_APPROVED_TEST_EVENT_CLEANUP" \
--     -v expectedReservations=0 \
--     -v expectedPayments=0 \
--     -v expectedTickets=0 \
--     -v expectedRefunds=0 \
--     -v expectedWebhookEvents=0 \
--     -v expectedSeatInventories=0 \
--     -f scripts/phase26/cleanup-test-event.sql
--
-- This script mutates data only inside a transaction after:
-- - dedicated PHASE26 test identifiers are provided,
-- - the real Girl Rules event is denied,
-- - dry-run counts exactly match expected values,
-- - no unexpected production rows are in scope,
-- - backup/restore-point and owner approval variables are explicit.

\if :{?performanceId}
\else
\echo 'Missing required psql variable: performanceId. Use -v performanceId="$PHASE26_TEST_PERFORMANCE_ID".'
\quit 2
\endif

\if :{?showtimeId}
\else
\echo 'Missing required psql variable: showtimeId. Use -v showtimeId="$PHASE26_TEST_SHOWTIME_ID".'
\quit 2
\endif

\if :{?orderPrefix}
\else
\echo 'Missing required psql variable: orderPrefix. Use -v orderPrefix="$PHASE26_TEST_ORDER_PREFIX".'
\quit 2
\endif

\if :{?testMarker}
\else
\echo 'Missing required psql variable: testMarker. Use -v testMarker="$PHASE26_TEST_MARKER".'
\quit 2
\endif

\if :{?backupConfirmation}
\else
\echo 'Missing required psql variable: backupConfirmation.'
\quit 2
\endif

\if :{?dryRunReviewed}
\else
\echo 'Missing required psql variable: dryRunReviewed.'
\quit 2
\endif

\if :{?ownerApproval}
\else
\echo 'Missing required psql variable: ownerApproval.'
\quit 2
\endif

\if :{?expectedReservations}
\else
\echo 'Missing required psql variable: expectedReservations.'
\quit 2
\endif

\if :{?expectedPayments}
\else
\echo 'Missing required psql variable: expectedPayments.'
\quit 2
\endif

\if :{?expectedTickets}
\else
\echo 'Missing required psql variable: expectedTickets.'
\quit 2
\endif

\if :{?expectedRefunds}
\else
\echo 'Missing required psql variable: expectedRefunds.'
\quit 2
\endif

\if :{?expectedWebhookEvents}
\else
\echo 'Missing required psql variable: expectedWebhookEvents.'
\quit 2
\endif

\if :{?expectedSeatInventories}
\else
\echo 'Missing required psql variable: expectedSeatInventories.'
\quit 2
\endif

begin;

create temp table phase26_cleanup_config as
select
  :'performanceId'::uuid as performance_id,
  :'showtimeId'::uuid as showtime_id,
  :'orderPrefix'::text as order_prefix,
  :'testMarker'::text as test_marker,
  :'backupConfirmation'::text as backup_confirmation,
  :'dryRunReviewed'::text as dry_run_reviewed,
  :'ownerApproval'::text as owner_approval,
  :'expectedReservations'::int as expected_reservations,
  :'expectedPayments'::int as expected_payments,
  :'expectedTickets'::int as expected_tickets,
  :'expectedRefunds'::int as expected_refunds,
  :'expectedWebhookEvents'::int as expected_webhook_events,
  :'expectedSeatInventories'::int as expected_seat_inventories;

do $$
declare
  cfg record;
  performance_title text;
  marker_present boolean;
begin
  select * into cfg from phase26_cleanup_config;

  if cfg.backup_confirmation <> 'PHASE26_BACKUP_RESTORE_POINT_CONFIRMED' then
    raise exception 'PHASE26 cleanup deny: backup/restore-point confirmation missing';
  end if;

  if cfg.dry_run_reviewed <> 'PHASE26_DRY_RUN_REVIEWED' then
    raise exception 'PHASE26 cleanup deny: dry-run evidence was not explicitly reviewed';
  end if;

  if cfg.owner_approval <> 'PHASE26_OWNER_APPROVED_TEST_EVENT_CLEANUP' then
    raise exception 'PHASE26 cleanup deny: owner approval confirmation missing';
  end if;

  if cfg.order_prefix !~ '^PHASE26[_-]' then
    raise exception 'PHASE26 cleanup deny: order prefix must start with PHASE26_ or PHASE26-, got %', cfg.order_prefix;
  end if;

  if length(cfg.test_marker) < 8 or cfg.test_marker !~* 'PHASE26|TEST' then
    raise exception 'PHASE26 cleanup deny: test marker must be explicit and include PHASE26 or TEST';
  end if;

  select p.title,
    (
      p.title ilike '%' || cfg.test_marker || '%'
      or coalesce(p.description, '') ilike '%' || cfg.test_marker || '%'
      or coalesce(p.sales_info, '') ilike '%' || cfg.test_marker || '%'
    )
    into performance_title, marker_present
  from performances p
  where p.id = cfg.performance_id;

  if performance_title is null then
    raise exception 'PHASE26 cleanup deny: performanceId % was not found', cfg.performance_id;
  end if;

  if performance_title ilike '%Girl Rules%'
    or performance_title ilike '%GIRL RULES%'
    or performance_title ilike '%걸룰%'
    or performance_title ilike '%걸룰스%' then
    raise exception 'PHASE26 cleanup deny: real Girl Rules performance is in cleanup scope';
  end if;

  if not marker_present then
    raise exception 'PHASE26 cleanup deny: performance does not contain the dedicated test marker in title/description/sales_info';
  end if;

  if not exists (
    select 1
    from showtimes s
    where s.id = cfg.showtime_id
      and s.performance_id = cfg.performance_id
  ) then
    raise exception 'PHASE26 cleanup deny: showtimeId % is not attached to performanceId %', cfg.showtime_id, cfg.performance_id;
  end if;
end $$;

create temp table phase26_scoped_reservations as
select r.id, r.toss_order_id, r.showtime_id, r.status
from reservations r
join phase26_cleanup_config cfg on cfg.showtime_id = r.showtime_id
where r.toss_order_id like (select order_prefix || '%' from phase26_cleanup_config)
for update;

create temp table phase26_scoped_payments as
select p.id, p.reservation_id, p.toss_order_id, p.status
from payments p
join phase26_scoped_reservations r on r.id = p.reservation_id
where p.toss_order_id like (select order_prefix || '%' from phase26_cleanup_config)
for update;

create temp table phase26_scoped_tickets as
select t.id, t.reservation_id, t.payment_id, t.showtime_id, t.status
from tickets t
join phase26_scoped_reservations r on r.id = t.reservation_id
where t.showtime_id = (select showtime_id from phase26_cleanup_config)
for update;

create temp table phase26_scoped_refunds as
select f.id, f.reservation_id, f.payment_id, f.status
from refunds f
join phase26_scoped_reservations r on r.id = f.reservation_id
for update;

create temp table phase26_scoped_webhooks as
select e.id, e.event_type, e.toss_order_id
from payment_webhook_events e
where e.toss_order_id like (select order_prefix || '%' from phase26_cleanup_config)
  or e.reservation_id in (select id from phase26_scoped_reservations)
  or e.payment_id in (select id from phase26_scoped_payments)
for update;

create temp table phase26_unexpected_rows as
select 'reservations_without_prefix' as check_name, count(*)::int as row_count
from reservations r
join phase26_cleanup_config cfg on cfg.showtime_id = r.showtime_id
where coalesce(r.toss_order_id, '') not like cfg.order_prefix || '%'
union all
select 'payments_without_prefix', count(*)::int
from payments p
join reservations r on r.id = p.reservation_id
join phase26_cleanup_config cfg on cfg.showtime_id = r.showtime_id
where coalesce(p.toss_order_id, '') not like cfg.order_prefix || '%'
union all
select 'tickets_outside_scoped_reservations', count(*)::int
from tickets t
join phase26_cleanup_config cfg on cfg.showtime_id = t.showtime_id
where t.reservation_id not in (select id from phase26_scoped_reservations)
union all
select 'showtime_mismatch', count(*)::int
from showtimes s
join phase26_cleanup_config cfg on cfg.showtime_id = s.id
where s.performance_id <> cfg.performance_id;

create temp table phase26_actual_counts as
select
  (select count(*)::int from phase26_scoped_reservations) as reservations_count,
  (select count(*)::int from phase26_scoped_payments) as payments_count,
  (select count(*)::int from phase26_scoped_tickets) as tickets_count,
  (select count(*)::int from phase26_scoped_refunds) as refunds_count,
  (select count(*)::int from phase26_scoped_webhooks) as webhook_events_count,
  (select count(*)::int from seat_inventories where showtime_id = (select showtime_id from phase26_cleanup_config)) as seat_inventories_count,
  (select coalesce(sum(row_count), 0)::int from phase26_unexpected_rows) as unexpected_count;

do $$
declare
  cfg record;
  actual record;
begin
  select * into cfg from phase26_cleanup_config;
  select * into actual from phase26_actual_counts;

  if actual.unexpected_count <> 0 then
    raise exception 'PHASE26 cleanup deny: unexpected production rows are in scope. Run cleanup-dry-run.sql and review unexpected rows.';
  end if;

  if actual.reservations_count <> cfg.expected_reservations then
    raise exception 'PHASE26 cleanup deny: reservations count mismatch actual=% expected=%', actual.reservations_count, cfg.expected_reservations;
  end if;
  if actual.payments_count <> cfg.expected_payments then
    raise exception 'PHASE26 cleanup deny: payments count mismatch actual=% expected=%', actual.payments_count, cfg.expected_payments;
  end if;
  if actual.tickets_count <> cfg.expected_tickets then
    raise exception 'PHASE26 cleanup deny: tickets count mismatch actual=% expected=%', actual.tickets_count, cfg.expected_tickets;
  end if;
  if actual.refunds_count <> cfg.expected_refunds then
    raise exception 'PHASE26 cleanup deny: refunds count mismatch actual=% expected=%', actual.refunds_count, cfg.expected_refunds;
  end if;
  if actual.webhook_events_count <> cfg.expected_webhook_events then
    raise exception 'PHASE26 cleanup deny: webhook event count mismatch actual=% expected=%', actual.webhook_events_count, cfg.expected_webhook_events;
  end if;
  if actual.seat_inventories_count <> cfg.expected_seat_inventories then
    raise exception 'PHASE26 cleanup deny: seat inventory count mismatch actual=% expected=%', actual.seat_inventories_count, cfg.expected_seat_inventories;
  end if;
end $$;

\echo 'PHASE26 cleanup execution counts approved'
select * from phase26_actual_counts;

with deleted as (
  delete from payment_webhook_events
  where id in (select id from phase26_scoped_webhooks)
  returning 1
)
select 'payment_webhook_events_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from refunds
  where id in (select id from phase26_scoped_refunds)
  returning 1
)
select 'refunds_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from tickets
  where id in (select id from phase26_scoped_tickets)
  returning 1
)
select 'tickets_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from payments
  where id in (select id from phase26_scoped_payments)
  returning 1
)
select 'payments_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from reservation_seats
  where reservation_id in (select id from phase26_scoped_reservations)
  returning 1
)
select 'reservation_seats_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from reservations
  where id in (select id from phase26_scoped_reservations)
  returning 1
)
select 'reservations_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from seat_inventories
  where showtime_id = (select showtime_id from phase26_cleanup_config)
  returning 1
)
select 'seat_inventories_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from showtimes
  where id = (select showtime_id from phase26_cleanup_config)
  returning 1
)
select 'showtimes_deleted' as action, count(*)::int as row_count from deleted;

with deleted as (
  delete from performances
  where id = (select performance_id from phase26_cleanup_config)
  returning 1
)
select 'performances_deleted_with_cascade' as action, count(*)::int as row_count from deleted;

\echo 'PHASE26 cleanup execution committed. Restore via the confirmed backup/restore point if verification detects drift.'

commit;
