CREATE TYPE "public"."variable_cardinality" AS ENUM('scalar', 'list');--> statement-breakpoint
CREATE TYPE "public"."template_item_kind" AS ENUM('global', 'organization');--> statement-breakpoint
CREATE TYPE "public"."item_placement" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('valid', 'invalid', 'stale', 'pending');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"repeat_variable_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"repeat_variable_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_variable_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"value" jsonb,
	"status" "validation_status" DEFAULT 'pending' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"last_good_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itglue_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_status" "validation_status" DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"trigger" text NOT NULL,
	"status" "validation_status" DEFAULT 'pending' NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"issue_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"kind" "template_item_kind" NOT NULL,
	"global_step_id" uuid,
	"organization_id" uuid,
	"source_organization_step_id" uuid,
	"snapshot_title" text,
	"snapshot_body" jsonb,
	"snapshot_repeat_variable_id" uuid,
	"anchor_item_id" uuid,
	"placement" "item_placement",
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_subject" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variable_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"asset_type_id" text NOT NULL,
	"asset_type_name" text NOT NULL,
	"cardinality" "variable_cardinality" NOT NULL,
	"selected_fields" jsonb NOT NULL,
	"validation_rules" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schema_valid" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_steps" ADD CONSTRAINT "global_steps_repeat_variable_id_variable_definitions_id_fk" FOREIGN KEY ("repeat_variable_id") REFERENCES "public"."variable_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_steps" ADD CONSTRAINT "organization_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_steps" ADD CONSTRAINT "organization_steps_repeat_variable_id_variable_definitions_id_fk" FOREIGN KEY ("repeat_variable_id") REFERENCES "public"."variable_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_values" ADD CONSTRAINT "organization_variable_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_values" ADD CONSTRAINT "organization_variable_values_definition_id_variable_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."variable_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_global_step_id_global_steps_id_fk" FOREIGN KEY ("global_step_id") REFERENCES "public"."global_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_source_organization_step_id_organization_steps_id_fk" FOREIGN KEY ("source_organization_step_id") REFERENCES "public"."organization_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_snapshot_repeat_variable_id_variable_definitions_id_fk" FOREIGN KEY ("snapshot_repeat_variable_id") REFERENCES "public"."variable_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "global_steps_active_idx" ON "global_steps" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "organization_steps_org_idx" ON "organization_steps" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_variable_value_uidx" ON "organization_variable_values" USING btree ("organization_id","definition_id");--> statement-breakpoint
CREATE INDEX "org_variable_status_idx" ON "organization_variable_values" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_itglue_id_uidx" ON "organizations" USING btree ("itglue_id");--> statement-breakpoint
CREATE INDEX "organizations_enabled_idx" ON "organizations" USING btree ("enabled","deleted_at");--> statement-breakpoint
CREATE INDEX "revisions_entity_idx" ON "revisions" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "template_items_order_idx" ON "template_items" USING btree ("template_id","position","deleted_at");--> statement-breakpoint
CREATE INDEX "template_items_org_idx" ON "template_items" USING btree ("template_id","organization_id");--> statement-breakpoint
CREATE INDEX "templates_active_idx" ON "templates" USING btree ("deleted_at","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_entra_subject_uidx" ON "users" USING btree ("entra_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "variable_definitions_key_uidx" ON "variable_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "variable_definitions_type_idx" ON "variable_definitions" USING btree ("asset_type_id","enabled");