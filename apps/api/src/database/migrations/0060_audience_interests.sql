CREATE TABLE "audience_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" varchar(40) NOT NULL,
	"action" varchar(16) NOT NULL,
	"use_behavior" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_consent_action" CHECK ("audience_consent_events"."action" in ('save','withdraw'))
);
--> statement-breakpoint
CREATE TABLE "audience_performance_tags" (
	"performance_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "audience_performance_tags_performance_id_tag_id_pk" PRIMARY KEY("performance_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "audience_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"consent_version" varchar(40) NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"behavior_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"labels" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "audience_tag_kind" CHECK ("audience_tags"."kind" in ('artist','activity','benefit'))
);
--> statement-breakpoint
CREATE TABLE "audience_user_tags" (
	"user_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "audience_user_tags_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "audience_consent_events" ADD CONSTRAINT "audience_consent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_performance_tags" ADD CONSTRAINT "audience_performance_tags_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_performance_tags" ADD CONSTRAINT "audience_performance_tags_tag_id_audience_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."audience_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_preferences" ADD CONSTRAINT "audience_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_user_tags" ADD CONSTRAINT "audience_user_tags_user_id_audience_preferences_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."audience_preferences"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_user_tags" ADD CONSTRAINT "audience_user_tags_tag_id_audience_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."audience_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audience_consent_events_expiry" ON "audience_consent_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_audience_performance_tags_tag" ON "audience_performance_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_audience_preferences_expiry" ON "audience_preferences" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_audience_user_tags_tag" ON "audience_user_tags" USING btree ("tag_id");
--> statement-breakpoint
INSERT INTO audience_tags(slug,kind,labels) VALUES
 ('namtanfilm','artist','{"ko":"NAMTANFILM","en":"NAMTANFILM","th":"NAMTANFILM","zh-CN":"NAMTANFILM"}'),
 ('fan-events','activity','{"ko":"팬미팅·팬 이벤트","en":"Fan meetings & events","th":"แฟนมีตติ้ง","zh-CN":"粉丝见面会"}'),
 ('live-music','activity','{"ko":"콘서트 관람","en":"Concerts","th":"คอนเสิร์ต","zh-CN":"演唱会"}'),
 ('musicals','activity','{"ko":"뮤지컬·연극 관람","en":"Musicals & theatre","th":"ละครเวทีและมิวสิคัล","zh-CN":"音乐剧与话剧"}'),
 ('exhibitions','activity','{"ko":"전시·팝업 방문","en":"Exhibitions & pop-ups","th":"นิทรรศการและป๊อปอัพ","zh-CN":"展览与快闪活动"}'),
 ('collecting-merch','activity','{"ko":"굿즈·포토카드 수집","en":"Merch & photocard collecting","th":"สะสมสินค้าและโฟโต้การ์ด","zh-CN":"周边与小卡收藏"}'),
 ('fan-content','activity','{"ko":"팬 콘텐츠 감상","en":"Watching fan content","th":"รับชมคอนเทนต์แฟนคลับ","zh-CN":"观看粉丝内容"}'),
 ('photo-experience','benefit','{"ko":"사진 촬영 혜택","en":"Photo opportunities","th":"สิทธิ์ถ่ายภาพ","zh-CN":"拍照福利"}'),
 ('autographs','benefit','{"ko":"사인 혜택","en":"Autographs","th":"ลายเซ็น","zh-CN":"签名福利"}'),
 ('merch-benefits','benefit','{"ko":"굿즈 혜택","en":"Merch benefits","th":"สิทธิพิเศษสินค้า","zh-CN":"周边福利"}'),
 ('seat-views','benefit','{"ko":"좌석·시야 안내","en":"Seats & viewing guides","th":"ข้อมูลที่นั่งและมุมมอง","zh-CN":"座位与视野介绍"}'),
 ('ticket-alerts','benefit','{"ko":"티켓 오픈 소식","en":"Ticket sale news","th":"ข่าวเปิดขายบัตร","zh-CN":"开票消息"}');
--> statement-breakpoint
-- Known public catalogue metadata; no customer records are backfilled.
INSERT INTO audience_performance_tags(performance_id,tag_id)
 SELECT p.id,t.id FROM performances p CROSS JOIN audience_tags t
 WHERE p.title='NAMTANFILM Fan Meeting in Seoul' AND t.slug IN ('namtanfilm','fan-events');
