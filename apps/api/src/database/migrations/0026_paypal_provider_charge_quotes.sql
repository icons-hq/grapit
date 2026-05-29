ALTER TABLE "reservations" ADD COLUMN "provider_charge_currency" varchar(10);
ALTER TABLE "reservations" ADD COLUMN "provider_charge_amount_minor" integer;
ALTER TABLE "reservations" ADD COLUMN "provider_charge_rate" varchar(50);
ALTER TABLE "reservations" ADD COLUMN "provider_charge_quoted_at" timestamp with time zone;

ALTER TABLE "payments" ADD COLUMN "provider_charge_currency" varchar(10);
ALTER TABLE "payments" ADD COLUMN "provider_charge_amount_minor" integer;
ALTER TABLE "payments" ADD COLUMN "provider_charge_rate" varchar(50);
ALTER TABLE "payments" ADD COLUMN "provider_charge_quoted_at" timestamp with time zone;
