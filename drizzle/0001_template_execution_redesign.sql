-- CHECKLIST_TEMPLATE_RESET: explicit cutover confirmation is required.
DELETE FROM "revisions" WHERE "entity_type" IN ('template', 'template_item', 'template_order', 'global_step', 'organization_step');
--> statement-breakpoint
DELETE FROM "template_items";
--> statement-breakpoint
DELETE FROM "templates";
--> statement-breakpoint
INSERT INTO "audit_events" ("event_type", "details") VALUES ('templates.redesign_reset', '{"scope":"legacy test templates and step libraries","preserved":"users, organizations, mappings, values, sync history, security audit"}'::jsonb);
--> statement-breakpoint
CREATE TABLE "checklist_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"step_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"repeat_index" integer,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"skip_reason" text DEFAULT '' NOT NULL,
	"status_changed_by" uuid,
	"status_changed_at" timestamp with time zone,
	"notes_changed_by" uuid,
	"notes_changed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_step_status_check" CHECK ("checklist_steps"."status" IN ('pending', 'completed', 'skipped') AND length("checklist_steps"."notes") <= 2000 AND length("checklist_steps"."skip_reason") <= 2000 AND ("checklist_steps"."status" <> 'skipped' OR length(trim("checklist_steps"."skip_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"template_name" text NOT NULL,
	"global_template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"global_template_version" integer NOT NULL,
	"variable_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"creation_key" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_status_check" CHECK ("checklists"."status" IN ('active', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "global_steps" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_steps" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "global_steps" CASCADE;--> statement-breakpoint
DROP TABLE "organization_steps" CASCADE;--> statement-breakpoint
ALTER TABLE "template_items" DROP CONSTRAINT IF EXISTS "template_items_global_step_id_global_steps_id_fk";
--> statement-breakpoint
ALTER TABLE "template_items" DROP CONSTRAINT "template_items_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "template_items" DROP CONSTRAINT IF EXISTS "template_items_source_organization_step_id_organization_steps_id_fk";
--> statement-breakpoint
ALTER TABLE "template_items" DROP CONSTRAINT "template_items_snapshot_repeat_variable_id_variable_definitions_id_fk";
--> statement-breakpoint
DROP INDEX "template_items_org_idx";--> statement-breakpoint
ALTER TABLE "template_items" ALTER COLUMN "placement" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "template_items" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "template_items" ADD COLUMN "body" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "template_items" ADD COLUMN "repeat_variable_id" uuid;--> statement-breakpoint
ALTER TABLE "template_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "global_template_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_activity" ADD CONSTRAINT "checklist_activity_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_activity" ADD CONSTRAINT "checklist_activity_step_id_checklist_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."checklist_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_activity" ADD CONSTRAINT "checklist_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_steps" ADD CONSTRAINT "checklist_steps_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_steps" ADD CONSTRAINT "checklist_steps_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_steps" ADD CONSTRAINT "checklist_steps_notes_changed_by_users_id_fk" FOREIGN KEY ("notes_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_global_template_id_templates_id_fk" FOREIGN KEY ("global_template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_activity_idx" ON "checklist_activity" USING btree ("checklist_id","created_at");--> statement-breakpoint
CREATE INDEX "checklist_steps_order_idx" ON "checklist_steps" USING btree ("checklist_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "checklists_creation_uidx" ON "checklists" USING btree ("created_by","creation_key");--> statement-breakpoint
CREATE INDEX "checklists_org_status_idx" ON "checklists" USING btree ("organization_id","status","deleted_at");--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_repeat_variable_id_variable_definitions_id_fk" FOREIGN KEY ("repeat_variable_id") REFERENCES "public"."variable_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_global_template_id_templates_id_fk" FOREIGN KEY ("global_template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templates_org_idx" ON "templates" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "global_step_id";--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "source_organization_step_id";--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "snapshot_title";--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "snapshot_body";--> statement-breakpoint
ALTER TABLE "template_items" DROP COLUMN "snapshot_repeat_variable_id";--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "step_placement_check" CHECK ("template_items"."placement" IS NULL OR "template_items"."placement" IN ('start', 'end', 'before', 'after'));--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "template_scope_check" CHECK (("templates"."scope" = 'global' AND "templates"."organization_id" IS NULL AND "templates"."global_template_id" IS NULL) OR ("templates"."scope" = 'organization' AND "templates"."organization_id" IS NOT NULL AND "templates"."global_template_id" IS NOT NULL AND "templates"."global_template_id" <> "templates"."id"));--> statement-breakpoint
DROP TYPE "public"."template_item_kind";--> statement-breakpoint
DROP TYPE "public"."item_placement";
