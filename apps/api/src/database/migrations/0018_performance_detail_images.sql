ALTER TABLE "performances"
  ADD COLUMN "detail_images" jsonb NOT NULL DEFAULT '[]'::jsonb;
