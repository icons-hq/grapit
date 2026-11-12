CREATE TABLE "analytics_replay_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"path" varchar(160) NOT NULL,
	"events" jsonb NOT NULL,
	"bytes" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_replay_chunks" ADD CONSTRAINT "analytics_replay_chunks_session_id_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analytics_replay_session" ON "analytics_replay_chunks" USING btree ("session_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_replay_recording" ON "analytics_replay_chunks" USING btree ("recording_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_replay_expiry" ON "analytics_replay_chunks" USING btree ("received_at");