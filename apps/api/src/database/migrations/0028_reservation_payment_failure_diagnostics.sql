CREATE TABLE "reservation_payment_failure_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid,
	"toss_order_id" varchar(200),
	"diagnostic_kind" varchar(80) NOT NULL,
	"diagnostic_code" varchar(100) NOT NULL,
	"diagnostic_message" varchar(500) NOT NULL,
	"diagnostic_source" varchar(80) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_check_status" varchar(50) DEFAULT 'not_checked' NOT NULL,
	"provider_checked_at" timestamp with time zone,
	"provider_check_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservation_payment_failure_diagnostics" ADD CONSTRAINT "rpfd_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_payment_failure_diagnostics" ADD CONSTRAINT "rpfd_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rpfd_reservation_id" ON "reservation_payment_failure_diagnostics" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_rpfd_payment_id" ON "reservation_payment_failure_diagnostics" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_rpfd_toss_order_id" ON "reservation_payment_failure_diagnostics" USING btree ("toss_order_id");--> statement-breakpoint
CREATE INDEX "idx_rpfd_recorded_at" ON "reservation_payment_failure_diagnostics" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_rpfd_provider_check_status" ON "reservation_payment_failure_diagnostics" USING btree ("provider_check_status");
--> statement-breakpoint
INSERT INTO "reservation_payment_failure_diagnostics" (
	"reservation_id",
	"payment_id",
	"toss_order_id",
	"diagnostic_kind",
	"diagnostic_code",
	"diagnostic_message",
	"diagnostic_source",
	"recorded_at"
)
SELECT
	r."id",
	p."id",
	coalesce(p."toss_order_id", r."toss_order_id"),
	case
		when p."status" = 'EXPIRED'
			or (p."id" is null and r."payment_deadline_at" is not null and r."payment_deadline_at" < now())
			then 'payment_expired'
		when p."status" = 'CANCELED'
			and r."status" = 'FAILED'
			and p."cancel_reason" = '판매 불가능 좌석으로 인한 자동 취소'
			then 'payment_compensated_cancel'
		when p."status" = 'CANCELED' then 'payment_cancelled_before_confirm'
		else 'payment_failed'
	end,
	case
		when p."status" = 'EXPIRED' then 'PAYMENT_EXPIRED'
		when p."id" is null and r."payment_deadline_at" is not null and r."payment_deadline_at" < now()
			then 'PAYMENT_DEADLINE_EXPIRED'
		when p."status" = 'ABORTED' then 'PAYMENT_ABORTED'
		when p."status" = 'CANCELED'
			and r."status" = 'FAILED'
			and p."cancel_reason" = '판매 불가능 좌석으로 인한 자동 취소'
			then 'ASYNC_DONE_SEAT_UNAVAILABLE_CANCELLED'
		when p."status" = 'CANCELED' then 'PAYMENT_CANCELED_BEFORE_CONFIRM'
		else 'PAYMENT_FAILED'
	end,
	case
		when p."status" = 'EXPIRED' then '결제 유효 시간이 만료되었습니다.'
		when p."id" is null and r."payment_deadline_at" is not null and r."payment_deadline_at" < now()
			then '결제 제한 시간이 만료되었습니다.'
		when p."status" = 'ABORTED' then '결제가 중단되었거나 실패했습니다.'
		when p."status" = 'CANCELED'
			and r."status" = 'FAILED'
			and p."cancel_reason" = '판매 불가능 좌석으로 인한 자동 취소'
			then '판매 불가능 좌석으로 인한 자동 취소'
		when p."status" = 'CANCELED' then coalesce(nullif(p."cancel_reason", ''), '결제 승인 전 취소되었습니다.')
		else '결제 실패 또는 미완료로 예매가 실패 처리되었습니다.'
	end,
	case
		when latest_webhook."event_id" is not null then 'payment_webhook_events'
		when p."id" is not null then 'payments'
		else 'pending_payment_expiration_worker'
	end,
	coalesce(latest_webhook."received_at", p."cancelled_at", p."created_at", r."updated_at", r."payment_deadline_at", now())
FROM "reservations" r
LEFT JOIN LATERAL (
	SELECT p_inner.*
	FROM "payments" p_inner
	WHERE p_inner."reservation_id" = r."id"
	ORDER BY p_inner."created_at" DESC
	LIMIT 1
) p ON true
LEFT JOIN LATERAL (
	SELECT wh."event_id", wh."received_at"
	FROM "payment_webhook_events" wh
	WHERE wh."reservation_id" = r."id"
		or wh."toss_order_id" = coalesce(p."toss_order_id", r."toss_order_id")
	ORDER BY wh."received_at" DESC
	LIMIT 1
) latest_webhook ON true
WHERE r."status" = 'FAILED'
	or (
		r."status" = 'PENDING_PAYMENT'
		and p."status" in ('ABORTED', 'EXPIRED', 'CANCELED')
	)
ON CONFLICT ("reservation_id") DO NOTHING;
