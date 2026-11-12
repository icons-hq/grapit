CREATE TABLE "analytics_counters" (
	"bucket" timestamp with time zone NOT NULL,
	"page" varchar(24) NOT NULL,
	"name" varchar(32) NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_counters_bucket_page_name_pk" PRIMARY KEY("bucket","page","name")
);
--> statement-breakpoint
CREATE TABLE "analytics_traffic_history" (
	"bucket" timestamp with time zone NOT NULL,
	"source" varchar(40) NOT NULL,
	"metric" varchar(40) NOT NULL,
	"count" integer NOT NULL,
	"sampled" boolean NOT NULL,
	"observed_through" timestamp with time zone NOT NULL,
	CONSTRAINT "analytics_traffic_history_bucket_source_metric_pk" PRIMARY KEY("bucket","source","metric")
);
--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD COLUMN "aggregate_enabled" boolean DEFAULT false NOT NULL;