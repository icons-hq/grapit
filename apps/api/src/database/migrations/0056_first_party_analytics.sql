CREATE TABLE "analytics_attribution" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"first_touch" jsonb NOT NULL,
	"last_touch" jsonb NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"path" varchar(160) NOT NULL,
	"previous_path" varchar(160),
	"props" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_opt_outs" (
	"visitor_hash" varchar(64) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_rollups" (
	"grain" varchar(8) NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"visitors" integer NOT NULL,
	"sessions" integer NOT NULL,
	"page_views" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_rollups_grain_bucket_pk" PRIMARY KEY("grain","bucket")
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"user_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"touch" jsonb NOT NULL,
	"consent_version" varchar(40) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"device" varchar(16) NOT NULL,
	"browser" varchar(16) NOT NULL,
	"os" varchar(16) NOT NULL,
	"screen" varchar(16) NOT NULL,
	"language" varchar(8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"notice_version" varchar(40),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"rebuild_since" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analytics_attribution" ADD CONSTRAINT "analytics_attribution_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analytics_attribution_expiry" ON "analytics_attribution" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_attribution_visitor" ON "analytics_attribution" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_occurred" ON "analytics_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_session_time" ON "analytics_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_opt_outs_expiry" ON "analytics_opt_outs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_visitor_time" ON "analytics_sessions" USING btree ("visitor_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_started" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_user" ON "analytics_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_last_seen" ON "analytics_sessions" USING btree ("last_seen_at");