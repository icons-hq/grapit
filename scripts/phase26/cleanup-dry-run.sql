\set ON_ERROR_STOP on
\pset pager off

-- Phase 26 dedicated test-event cleanup dry-run.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v performanceId="$PHASE26_TEST_PERFORMANCE_ID" \
--     -v showtimeId="$PHASE26_TEST_SHOWTIME_ID" \
--     -v orderPrefix="$PHASE26_TEST_ORDER_PREFIX" \
--     -v testMarker="$PHASE26_TEST_MARKER" \
--     -f scripts/phase26/cleanup-dry-run.sql
--
-- Safety contract:
-- - This script is read-only and returns counts plus masked row identifiers.
-- - It refuses the real Girl Rules event by title/marker deny checks.
-- - It flags unexpected rows before cleanup-test-event.sql can mutate anything.
-- - Do not paste auth headers, payment keys, cookies, phone/email PII, or raw row
--   dumps into evidence.

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

begin;

create temp table phase26_cleanup_config as
select
  :'performanceId'::uuid as performance_id,
  :'showtimeId'::uuid as showtime_id,
  :'orderPrefix'::text as order_prefix,
  :'testMarker'::text as test_marker;

do $$
declare
  cfg record;
  performance_title text;
  marker_present boolean;
begin
  select * into cfg from phase26_cleanup_config;

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
where r.toss_order_id like (select order_prefix || '%' from phase26_cleanup_config);

create temp table phase26_scoped_payments as
select p.id, p.reservation_id, p.toss_order_id, p.status
from payments p
join phase26_scoped_reservations r on r.id = p.reservation_id
where p.toss_order_id like (select order_prefix || '%' from phase26_cleanup_config);

create temp table phase26_scoped_tickets as
select t.id, t.reservation_id, t.payment_id, t.showtime_id, t.status
from tickets t
join phase26_scoped_reservations r on r.id = t.reservation_id
where t.showtime_id = (select showtime_id from phase26_cleanup_config);

create temp table phase26_scoped_refunds as
select f.id, f.reservation_id, f.payment_id, f.status
from refunds f
join phase26_scoped_reservations r on r.id = f.reservation_id;

create temp table phase26_scoped_webhooks as
select e.id, e.event_type, e.toss_order_id
from payment_webhook_events e
where e.toss_order_id like (select order_prefix || '%' from phase26_cleanup_config)
  or e.reservation_id in (select id from phase26_scoped_reservations)
  or e.payment_id in (select id from phase26_scoped_payments);

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

\echo 'PHASE26 cleanup dry-run scope'
select
  'PHASE26 cleanup dry-run' as check_name,
  left(cfg.performance_id::text, 8) || '...' || right(cfg.performance_id::text, 4) as masked_performance_id,
  left(cfg.showtime_id::text, 8) || '...' || right(cfg.showtime_id::text, 4) as masked_showtime_id,
  cfg.order_prefix,
  cfg.test_marker
from phase26_cleanup_config cfg;

\echo 'PHASE26 cleanup dry-run counts'
select 'reservations' as table_name, count(*)::int as rows_to_touch from phase26_scoped_reservations
union all select 'reservation_seats', count(*)::int from reservation_seats where reservation_id in (select id from phase26_scoped_reservations)
union all select 'payments', count(*)::int from phase26_scoped_payments
union all select 'payment_webhook_events', count(*)::int from phase26_scoped_webhooks
union all select 'tickets', count(*)::int from phase26_scoped_tickets
union all select 'refunds', count(*)::int from phase26_scoped_refunds
union all select 'seat_inventories', count(*)::int from seat_inventories where showtime_id = (select showtime_id from phase26_cleanup_config)
union all select 'showtimes', count(*)::int from showtimes where id = (select showtime_id from phase26_cleanup_config)
union all select 'performances', count(*)::int from performances where id = (select performance_id from phase26_cleanup_config)
union all select 'booking_policies', count(*)::int from booking_policies where performance_id = (select performance_id from phase26_cleanup_config)
union all select 'price_tiers', count(*)::int from price_tiers where performance_id = (select performance_id from phase26_cleanup_config)
union all select 'castings', count(*)::int from castings where performance_id = (select performance_id from phase26_cleanup_config)
union all select 'seat_maps', count(*)::int from seat_maps where performance_id = (select performance_id from phase26_cleanup_config)
order by table_name;

\echo 'PHASE26 cleanup dry-run masked reservations'
select
  left(id::text, 8) || '...' || right(id::text, 4) as masked_reservation_id,
  left(toss_order_id, length((select order_prefix from phase26_cleanup_config))) || '<redacted-suffix>' as masked_order,
  status
from phase26_scoped_reservations
order by masked_reservation_id
limit 50;

\echo 'PHASE26 cleanup dry-run unexpected rows - execution must abort unless every count is 0'
select * from phase26_unexpected_rows order by check_name;

\echo 'PHASE26 cleanup dry-run completed. Review counts, confirm backup/restore point, then pass exact expected counts to cleanup-test-event.sql.'

rollback;
