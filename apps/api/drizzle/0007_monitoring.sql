CREATE TABLE "monitor_allowances" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"max_monitors" integer NOT NULL,
	"min_interval_seconds" integer NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_status_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"url" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"org_id" uuid,
	"origin" text DEFAULT 'kuma' NOT NULL,
	"name" text NOT NULL,
	"provider_name" text NOT NULL,
	"type" text NOT NULL,
	"target" text,
	"target_host" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"active" boolean,
	"interval_seconds" integer,
	"facts" jsonb,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"last_synced_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitor_allowances" ADD CONSTRAINT "monitor_allowances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_allowances" ADD CONSTRAINT "monitor_allowances_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_allowances" ADD CONSTRAINT "monitor_allowances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_status_pages" ADD CONSTRAINT "monitor_status_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_status_pages" ADD CONSTRAINT "monitor_status_pages_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_status_pages" ADD CONSTRAINT "monitor_status_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_status_pages_org_provider_idx" ON "monitor_status_pages" USING btree ("org_id","provider_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitors_provider_external_idx" ON "monitors" USING btree ("provider_connection_id","external_id");--> statement-breakpoint
CREATE INDEX "monitors_org_idx" ON "monitors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "monitors_org_host_idx" ON "monitors" USING btree ("org_id","target_host");