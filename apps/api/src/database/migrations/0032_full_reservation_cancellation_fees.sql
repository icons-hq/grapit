ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'PARTIAL_CANCELED' BEFORE 'CANCELED';--> statement-breakpoint

UPDATE "reservations" r
SET "cancel_deadline" = (
  (
    date_trunc('day', s."date_time" AT TIME ZONE 'Asia/Seoul')
    - interval '1 millisecond'
  ) AT TIME ZONE 'Asia/Seoul'
)
FROM "showtimes" s
WHERE r."showtime_id" = s."id"
  AND r."status" IN ('CONFIRMED', 'PENDING_PAYMENT');--> statement-breakpoint
