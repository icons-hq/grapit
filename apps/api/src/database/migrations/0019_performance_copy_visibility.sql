ALTER TABLE "performances"
  ADD COLUMN "description_visible" boolean NOT NULL DEFAULT true;

ALTER TABLE "performances"
  ADD COLUMN "sales_info_visible" boolean NOT NULL DEFAULT true;
