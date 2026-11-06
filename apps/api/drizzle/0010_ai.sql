CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"feature" text NOT NULL,
	"scope" text NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"counts_for_user" boolean DEFAULT true NOT NULL,
	"model" text NOT NULL,
	"served_model" text,
	"status" text DEFAULT 'running' NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"live_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error_code" text,
	"error_reason" text,
	"error_message" text,
	"request_id" text
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_disabled_by" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_opt_out_by" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_org_created_idx" ON "ai_usage" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_running_idx" ON "ai_usage" USING btree ("created_at") WHERE "ai_usage"."status" = 'running';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ai_opt_out_by_users_id_fk" FOREIGN KEY ("ai_opt_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
-- No data statement (plan O34): AI is opt-in per customer, every existing organization starts off.
