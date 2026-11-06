CREATE TABLE "translation_glossary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"keep" boolean DEFAULT false NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"built_in" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"locales" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"replace_manual" boolean DEFAULT false NOT NULL,
	"model" text NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"batches" jsonb NOT NULL,
	"done_batches" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"total" integer NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"estimate_micros" bigint NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" jsonb,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"runner" text,
	"heartbeat_at" timestamp with time zone,
	"retry_of" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_jobs_status_check" CHECK ("translation_jobs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "translation_overrides" (
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"value" text NOT NULL,
	"origin" text NOT NULL,
	"source_hash" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_overrides_key_locale_pk" PRIMARY KEY("key","locale"),
	CONSTRAINT "translation_overrides_locale_check" CHECK ("translation_overrides"."locale" in ('de', 'en', 'fr', 'it', 'nl')),
	CONSTRAINT "translation_overrides_origin_check" CHECK ("translation_overrides"."origin" in ('manual', 'ai'))
);
--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "translation_glossary" ADD CONSTRAINT "translation_glossary_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_retry_of_translation_jobs_id_fk" FOREIGN KEY ("retry_of") REFERENCES "public"."translation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_overrides" ADD CONSTRAINT "translation_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "translation_glossary_term_idx" ON "translation_glossary" USING btree (lower("term"));--> statement-breakpoint
CREATE INDEX "translation_jobs_created_idx" ON "translation_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "translation_jobs_active_idx" ON "translation_jobs" USING btree ((true)) WHERE "translation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "translation_overrides_locale_idx" ON "translation_overrides" USING btree ("locale");--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_locale_check" CHECK ("billing_profiles"."locale" is null or "billing_profiles"."locale" in ('de', 'en', 'fr', 'it', 'nl'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_locale_check" CHECK ("invoices"."locale" is null or "invoices"."locale" in ('de', 'en', 'fr', 'it', 'nl'));--> statement-breakpoint
-- Hand edit: normalize stored languages before the constraint below can reject them. PATCH /auth/me accepts
-- only de and en today, but rows written by scripts or by hand may carry de-CH, EN or anything else.
UPDATE "users" SET "locale" = CASE
  WHEN lower("locale") LIKE 'en%' THEN 'en'
  WHEN lower("locale") LIKE 'fr%' THEN 'fr'
  WHEN lower("locale") LIKE 'it%' THEN 'it'
  WHEN lower("locale") LIKE 'nl%' THEN 'nl'
  ELSE 'de' END
WHERE "locale" NOT IN ('de', 'en', 'fr', 'it', 'nl');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('de', 'en', 'fr', 'it', 'nl'));
