CREATE TABLE "media_seerr" (
	"provider_connection_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"last_check" jsonb,
	"checked_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_accounts" ADD COLUMN "seerr_user_id" integer;--> statement-breakpoint
ALTER TABLE "media_accounts" ADD COLUMN "seerr_requests" jsonb;--> statement-breakpoint
ALTER TABLE "media_accounts" ADD COLUMN "seerr_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD COLUMN "requests_movies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD COLUMN "requests_tv" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD COLUMN "movie_quota_limit" integer;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD COLUMN "movie_quota_days" integer;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD COLUMN "tv_quota_limit" integer;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD COLUMN "tv_quota_days" integer;--> statement-breakpoint
ALTER TABLE "media_seerr" ADD CONSTRAINT "media_seerr_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_seerr" ADD CONSTRAINT "media_seerr_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;