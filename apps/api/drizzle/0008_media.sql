CREATE TABLE "media_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"username" text NOT NULL,
	"org_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"has_password" boolean DEFAULT true NOT NULL,
	"last_activity_at" timestamp with time zone,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_allowances" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"max_accounts" integer NOT NULL,
	"libraries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_streams" integer NOT NULL,
	"downloads" boolean DEFAULT false NOT NULL,
	"remote_bitrate_mbit" integer,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_accounts" ADD CONSTRAINT "media_accounts_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_accounts" ADD CONSTRAINT "media_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD CONSTRAINT "media_allowances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD CONSTRAINT "media_allowances_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_allowances" ADD CONSTRAINT "media_allowances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_accounts_provider_external_idx" ON "media_accounts" USING btree ("provider_connection_id","external_id");--> statement-breakpoint
CREATE INDEX "media_accounts_org_idx" ON "media_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "media_accounts_username_lower_idx" ON "media_accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "media_allowances_account_code_idx" ON "media_allowances" USING btree ("account_code");--> statement-breakpoint
CREATE INDEX "media_allowances_provider_idx" ON "media_allowances" USING btree ("provider_connection_id");