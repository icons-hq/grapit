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
-- - It applies the same positive identification as cleanup-test-event.sql:
--   the marker must match ^PHASE26[_-][A-Za-z0-9_-]{6,}$, the performance title
--   must start with it, and published or future-opening performances are refused.
--   Order IDs are matched literally with starts_with(), never LIKE patterns.
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
  target record;
begin
  select * into cfg from phase26_cleanup_config;

  -- Order IDs are matched with starts_with(), so the prefix is a literal, but
  -- keep it to the same safe alphabet as generated PHASE26 order IDs.
  if cfg.order_prefix !~ '^PHASE26[_-][A-Za-z0-9_-]*$' then
    raise exception 'PHASE26 cleanup deny: order prefix must start with PHASE26_ or PHASE26- and use only letters, digits, _ or -, got %', cfg.order_prefix;
  end if;

  -- Positive identification only. A marker is a dedicated token, never a word
  -- that can appear in real performance copy, and the title must start with it.
  if cfg.test_marker !~ '^PHASE26[_-][A-Za-z0-9_-]{6,}$' then
    raise exception 'PHASE26 cleanup deny: test marker must match ^PHASE26[_-][A-Za-z0-9_-]{6,}$';
  end if;

  select p.title, p.publish_state::text as publish_state, bp.booking_starts_at
    into target
  from performances p
  left join booking_policies bp on bp.performance_id = p.id
  where p.id = cfg.performance_id;

  if not found then
    raise exception 'PHASE26 cleanup deny: performanceId % was not found', cfg.performance_id;
  end if;

  if not starts_with(target.title, cfg.test_marker) then
    raise exception 'PHASE26 cleanup deny: performance title must start with the dedicated test marker';
  end if;

  if target.title ilike '%Girl Rules%'
    or target.title ilike '%걸룰%' then
    raise exception 'PHASE26 cleanup deny: real Girl Rules performance is in cleanup scope';
  end if;

  -- A published performance is customer-visible and bookable; a future booking
  -- opening means a sale is still scheduled. Unpublish/close the dedicated test
  -- event in admin first; never delete inventory a sale may depend on.
  if target.publish_state = 'published' then
    raise exception 'PHASE26 cleanup deny: performance is published; unpublish the dedicated test event before cleanup';
  end if;

  if target.booking_starts_at is not null and target.booking_starts_at > now() then
    raise exception 'PHASE26 cleanup deny: performance has a scheduled future booking opening';
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
where starts_with(r.toss_order_id, (select order_prefix from phase26_cleanup_config));

create temp table phase26_scoped_payments as
select p.id, p.reservation_id, p.toss_order_id, p.status
from payments p
join phase26_scoped_reservations r on r.id = p.reservation_id
where starts_with(p.toss_order_id, (select order_prefix from phase26_cleanup_config));

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
where starts_with(coalesce(e.toss_order_id, ''), (select order_prefix from phase26_cleanup_config))
  or e.reservation_id in (select id from phase26_scoped_reservations)
  or e.payment_id in (select id from phase26_scoped_payments);

create temp table phase26_unexpected_rows as
select 'reservations_without_prefix' as check_name, count(*)::int as row_count
from reservations r
join phase26_cleanup_config cfg on cfg.showtime_id = r.showtime_id
where not starts_with(coalesce(r.toss_order_id, ''), cfg.order_prefix)
union all
select 'payments_without_prefix', count(*)::int
from payments p
join reservations r on r.id = p.reservation_id
join phase26_cleanup_config cfg on cfg.showtime_id = r.showtime_id
where not starts_with(coalesce(p.toss_order_id, ''), cfg.order_prefix)
union all
select 'tickets_outside_scoped_reservations', count(*)::int
from tickets t
join phase26_cleanup_config cfg on cfg.showtime_id = t.showtime_id
where t.reservation_id not in (select id from phase26_scoped_reservations)
union all
select 'ticket_items_outside_scoped_reservations', count(*)::int
from ticket_items ti
join phase26_cleanup_config cfg on cfg.showtime_id = ti.showtime_id
where ti.reservation_id not in (select id from phase26_scoped_reservations)
union all
select 'showtime_mismatch', count(*)::int
from showtimes s
join phase26_cleanup_config cfg on cfg.showtime_id = s.id
where s.performance_id <> cfg.performance_id
union all
select 'other_showtimes_for_performance', count(*)::int
from showtimes s
join phase26_cleanup_config cfg on cfg.performance_id = s.performance_id
where s.id <> cfg.showtime_id;

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
