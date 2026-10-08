ALTER TABLE "organizations" ADD COLUMN "suspended_by" text;--> statement-breakpoint
-- Who suspended an organization before this column existed is unknown. Treat it as a
-- platform suspension: staff can lift it, a reseller can't overrule it.
UPDATE "organizations" SET "suspended_by" = 'platform' WHERE "status" = 'suspended';
