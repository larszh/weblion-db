CREATE TABLE "phone_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"provider_name" text,
	"fqdn" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"status_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"info" jsonb,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phone_systems" ADD CONSTRAINT "phone_systems_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_systems" ADD CONSTRAINT "phone_systems_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_systems_provider_external_idx" ON "phone_systems" USING btree ("provider_connection_id","external_id");--> statement-breakpoint
CREATE INDEX "phone_systems_org_idx" ON "phone_systems" USING btree ("org_id");