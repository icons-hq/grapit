CREATE TABLE "performance_favorites" (
	"user_id" uuid NOT NULL,
	"performance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_favorites_user_id_performance_id_pk" PRIMARY KEY("user_id","performance_id")
);
--> statement-breakpoint
ALTER TABLE "performance_favorites" ADD CONSTRAINT "performance_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_favorites" ADD CONSTRAINT "performance_favorites_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_performance_favorites_user_created" ON "performance_favorites" USING btree ("user_id","created_at");