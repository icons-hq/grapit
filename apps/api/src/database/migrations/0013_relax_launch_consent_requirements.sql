UPDATE "consent_items"
SET
  "is_required" = false,
  "is_active" = false,
  "updated_at" = now()
WHERE "key" IN (
  'cross_border_transfer',
  'pdpa_notice',
  'pipl_notice'
);
