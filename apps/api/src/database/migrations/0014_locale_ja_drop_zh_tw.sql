ALTER TABLE "consent_audit_logs" ALTER COLUMN "language" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "translation_drafts" ALTER COLUMN "target_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
UPDATE "consent_audit_logs" AS "logs"
SET
  "consent_item_id" = "zh_cn"."id",
  "language" = 'zh-CN'
FROM "consent_items" AS "zh_tw"
JOIN "consent_items" AS "zh_cn"
  ON "zh_cn"."key" = "zh_tw"."key"
 AND "zh_cn"."version" = "zh_tw"."version"
 AND "zh_cn"."locale" = 'zh-CN'
WHERE "logs"."consent_item_id" = "zh_tw"."id"
  AND "zh_tw"."locale" = 'zh-TW';--> statement-breakpoint
UPDATE "consent_audit_logs" SET "language" = 'zh-CN' WHERE "language" = 'zh-TW';--> statement-breakpoint
DELETE FROM "consent_items" WHERE "locale" = 'zh-TW';--> statement-breakpoint
DELETE FROM "translation_drafts" AS "zh_tw"
WHERE "zh_tw"."target_locale" = 'zh-TW'
  AND EXISTS (
    SELECT 1
    FROM "translation_drafts" AS "zh_cn"
    WHERE "zh_cn"."source_id" = "zh_tw"."source_id"
      AND "zh_cn"."target_locale" = 'zh-CN'
  );--> statement-breakpoint
UPDATE "translation_drafts" SET "target_locale" = 'zh-CN' WHERE "target_locale" = 'zh-TW';--> statement-breakpoint
UPDATE "translation_sources" SET "source_locale" = 'zh-CN' WHERE "source_locale" = 'zh-TW';--> statement-breakpoint
UPDATE "users" SET "preferred_locale" = 'zh-CN' WHERE "preferred_locale" = 'zh-TW';--> statement-breakpoint
DROP TYPE "public"."locale";--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ko', 'en', 'th', 'zh-CN', 'ja');--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ALTER COLUMN "language" SET DATA TYPE "public"."locale" USING "language"::"public"."locale";--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DATA TYPE "public"."locale" USING "locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "translation_drafts" ALTER COLUMN "target_locale" SET DATA TYPE "public"."locale" USING "target_locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DATA TYPE "public"."locale" USING "source_locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DATA TYPE "public"."locale" USING "preferred_locale"::"public"."locale";--> statement-breakpoint
INSERT INTO "consent_items"
  ("key", "version", "locale", "title", "body", "is_required", "is_active")
VALUES
  ('terms', '2026-04-28', 'ja', '利用規約', 'Grabit の利用規約および会員の権利義務に同意します。', true, true),
  ('privacy', '2026-04-28', 'ja', 'プライバシーポリシー', 'Grabit がプライバシーポリシーに従って個人情報を処理することに同意します。', true, true),
  ('pipa_required', '2026-04-28', 'ja', '必須個人情報の収集・利用', '登録、本人確認、予約に必要な個人情報の収集および利用に同意します。', true, true),
  ('cross_border_transfer', '2026-04-28', 'ja', '個人情報の越境移転', 'サービス提供に必要な個人情報の越境移転について確認しました。', false, false),
  ('pdpa_notice', '2026-04-28', 'ja', 'タイ PDPA 通知', 'タイの利用者向け PDPA プライバシー通知を確認しました。', false, false),
  ('pipl_notice', '2026-04-28', 'ja', '中国 PIPL 通知', '中国の利用者向け PIPL プライバシー通知を確認しました。', false, false),
  ('marketing', '2026-04-28', 'ja', 'マーケティング受信同意', '公演、展示、特典などのマーケティング情報を受け取ることに同意します。', false, true)
ON CONFLICT ("key", "version", "locale")
DO UPDATE SET
  "title" = EXCLUDED."title",
  "body" = EXCLUDED."body",
  "is_required" = EXCLUDED."is_required",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = now();
