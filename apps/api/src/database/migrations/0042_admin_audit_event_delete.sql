-- Performance deletion is destructive (showtimes, seat inventory, prices and
-- benefit settings cascade), so it needs its own durable audit action.
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'event.delete';
