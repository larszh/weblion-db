CREATE TABLE "website_allowances" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"max_sites" integer NOT NULL,
	"max_databases" integer NOT NULL,
	"site_types" jsonb DEFAULT '["php","static"]'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webspace_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webspace_id" uuid NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"size_bytes" bigint,
	"last_synced_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webspaces" ADD COLUMN "kind" text DEFAULT 'webspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "webspaces" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "website_allowances" ADD CONSTRAINT "website_allowances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_allowances" ADD CONSTRAINT "website_allowances_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_allowances" ADD CONSTRAINT "website_allowances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webspace_databases" ADD CONSTRAINT "webspace_databases_webspace_id_webspaces_id_fk" FOREIGN KEY ("webspace_id") REFERENCES "public"."webspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webspace_databases" ADD CONSTRAINT "webspace_databases_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webspace_databases_provider_name_idx" ON "webspace_databases" USING btree ("provider_connection_id","name");--> statement-breakpoint
CREATE INDEX "webspace_databases_webspace_idx" ON "webspace_databases" USING btree ("webspace_id");--> statement-breakpoint
CREATE INDEX "webspaces_kind_org_idx" ON "webspaces" USING btree ("kind","org_id");