DELETE FROM "social_accounts"
USING "users"
WHERE "social_accounts"."user_id" = "users"."id"
  AND "users"."account_status" = 'withdrawn';
