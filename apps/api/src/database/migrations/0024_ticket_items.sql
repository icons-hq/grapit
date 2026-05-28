CREATE TYPE "public"."ticket_item_status" AS ENUM('active', 'cancellation_pending', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ticket_item_admission_state" AS ENUM('not_entered', 'entered');--> statement-breakpoint
CREATE TYPE "public"."ticket_item_reopen_state" AS ENUM('not_required', 'held_cancelled', 'available', 'manual_opened');--> statement-breakpoint
CREATE TABLE "ticket_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"showtime_id" uuid NOT NULL,
	"seat_id" varchar(120) NOT NULL,
	"seat_key" varchar(120) NOT NULL,
	"floor_key" varchar(50) NOT NULL,
	"floor_label" varchar(100) NOT NULL,
	"tier_name" varchar(50) NOT NULL,
	"row" varchar(50) NOT NULL,
	"number" varchar(50) NOT NULL,
	"price" integer NOT NULL,
	"service_fee" integer DEFAULT 2000 NOT NULL,
	"status" "ticket_item_status" DEFAULT 'active' NOT NULL,
	"admission_state" "ticket_item_admission_state" DEFAULT 'not_entered' NOT NULL,
	"entered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(200),
	"cancellation_fee" integer DEFAULT 0 NOT NULL,
	"service_fee_refund" integer DEFAULT 0 NOT NULL,
	"refundable_amount" integer DEFAULT 0 NOT NULL,
	"reopen_state" "ticket_item_reopen_state" DEFAULT 'not_required' NOT NULL,
	"reopen_hold_until" timestamp with time zone,
	"reopen_job_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_items" ADD CONSTRAINT "ticket_items_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD CONSTRAINT "ticket_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD CONSTRAINT "ticket_items_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_items_reservation_seat" ON "ticket_items" USING btree ("reservation_id","seat_key");--> statement-breakpoint
CREATE INDEX "idx_ticket_items_reservation_id" ON "ticket_items" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_items_payment_id" ON "ticket_items" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_items_showtime_id" ON "ticket_items" USING btree ("showtime_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_items_status" ON "ticket_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ticket_items_admission_state" ON "ticket_items" USING btree ("admission_state");--> statement-breakpoint
INSERT INTO "ticket_items" (
	"reservation_id",
	"payment_id",
	"showtime_id",
	"seat_id",
	"seat_key",
	"floor_key",
	"floor_label",
	"tier_name",
	"row",
	"number",
	"price",
		"service_fee",
		"status",
		"admission_state",
		"entered_at",
		"cancelled_at",
		"cancel_reason",
		"created_at",
	"updated_at"
)
SELECT
	rs."reservation_id",
	p."id",
	r."showtime_id",
	CASE
		WHEN position(':' in rs."seat_id") > 0 THEN split_part(rs."seat_id", ':', 2)
		ELSE rs."seat_id"
	END,
	CASE
		WHEN position(':' in rs."seat_id") > 0 THEN rs."seat_id"
		ELSE '1F:' || rs."seat_id"
	END,
	CASE
		WHEN position(':' in rs."seat_id") > 0 THEN split_part(rs."seat_id", ':', 1)
		ELSE '1F'
	END,
	CASE
		WHEN position(':' in rs."seat_id") > 0 THEN split_part(rs."seat_id", ':', 1)
		ELSE '1층'
	END,
	rs."tier_name",
	rs."row",
	rs."number",
	rs."price",
	CASE
		WHEN r."total_amount" = seat_totals."seat_total" + seat_totals."seat_count" * 2000
			AND p."amount" = seat_totals."seat_total" + seat_totals."seat_count" * 2000
			THEN 2000
		ELSE 0
	END,
	CASE
		WHEN r."status" = 'CANCELLED' THEN 'cancelled'::"ticket_item_status"
			ELSE 'active'::"ticket_item_status"
		END,
		CASE
			WHEN legacy_entry."has_entered" THEN 'entered'::"ticket_item_admission_state"
			ELSE 'not_entered'::"ticket_item_admission_state"
		END,
		CASE
			WHEN legacy_entry."has_entered" THEN legacy_entry."entered_at"
			ELSE NULL
		END,
		r."cancelled_at",
		r."cancel_reason",
		now(),
	now()
FROM "reservation_seats" rs
JOIN "reservations" r ON r."id" = rs."reservation_id"
JOIN "payments" p ON p."reservation_id" = rs."reservation_id"
JOIN (
	SELECT
		"reservation_id",
		sum("price") AS "seat_total",
		count(*) AS "seat_count"
		FROM "reservation_seats"
		GROUP BY "reservation_id"
	) seat_totals ON seat_totals."reservation_id" = rs."reservation_id"
	LEFT JOIN LATERAL (
		SELECT
			(
				EXISTS (
					SELECT 1
					FROM "tickets" legacy_ticket
					WHERE legacy_ticket."reservation_id" = r."id"
						AND (
							legacy_ticket."status" = 'used'
							OR legacy_ticket."used_at" IS NOT NULL
						)
				)
				OR EXISTS (
					SELECT 1
					FROM "ticket_scan_events" legacy_scan
					WHERE legacy_scan."reservation_id" = r."id"
						AND legacy_scan."result" IN ('success', 'offline_synced', 'already_used')
				)
			) AS "has_entered",
			COALESCE(
				(
					SELECT min(legacy_ticket."used_at")
					FROM "tickets" legacy_ticket
					WHERE legacy_ticket."reservation_id" = r."id"
						AND legacy_ticket."used_at" IS NOT NULL
				),
				(
					SELECT min(legacy_scan."scanned_at")
					FROM "ticket_scan_events" legacy_scan
					WHERE legacy_scan."reservation_id" = r."id"
						AND legacy_scan."result" IN ('success', 'offline_synced', 'already_used')
				),
				now()
			) AS "entered_at"
	) legacy_entry ON true
	WHERE r."status" IN ('CONFIRMED', 'CANCELLED')
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ticket_item_id" uuid;--> statement-breakpoint
-- Existing tickets.ticket_item_id rows intentionally remain NULL because legacy reservation-level QR payloads cannot be safely attributed to one seat.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_item_id_ticket_items_id_fk" FOREIGN KEY ("ticket_item_id") REFERENCES "public"."ticket_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "public"."idx_tickets_reservation_id";--> statement-breakpoint
DROP INDEX "public"."idx_tickets_payment_id";--> statement-breakpoint
CREATE INDEX "idx_tickets_reservation_id" ON "tickets" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_payment_id" ON "tickets" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tickets_ticket_item_active" ON "tickets" USING btree ("ticket_item_id") WHERE "tickets"."ticket_item_id" IS NOT NULL AND "tickets"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tickets_legacy_reservation_active" ON "tickets" USING btree ("reservation_id") WHERE "tickets"."ticket_item_id" IS NULL AND "tickets"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tickets_legacy_payment_active" ON "tickets" USING btree ("payment_id") WHERE "tickets"."ticket_item_id" IS NULL AND "tickets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_tickets_ticket_item_id" ON "tickets" USING btree ("ticket_item_id");--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ADD COLUMN "ticket_item_id" uuid;--> statement-breakpoint
-- Existing ticket_scan_events.ticket_item_id rows intentionally remain NULL for the same reason; integrated scanner rollout rejects legacy payloads without ticketItemId.
ALTER TABLE "ticket_scan_events" ADD CONSTRAINT "ticket_scan_events_ticket_item_id_ticket_items_id_fk" FOREIGN KEY ("ticket_item_id") REFERENCES "public"."ticket_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_scan_events_ticket_item_id" ON "ticket_scan_events" USING btree ("ticket_item_id");
