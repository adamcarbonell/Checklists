ALTER TABLE "template_items" ADD COLUMN "node_type" text DEFAULT 'step' NOT NULL;
--> statement-breakpoint
ALTER TABLE "template_items" ADD COLUMN "parent_branch_id" uuid;
--> statement-breakpoint
CREATE TABLE "template_condition_branches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_item_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "condition" jsonb,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "template_condition_branches_group_item_id_template_items_id_fk" FOREIGN KEY ("group_item_id") REFERENCES "template_items"("id")
);
--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_parent_branch_id_template_condition_branches_id_fk" FOREIGN KEY ("parent_branch_id") REFERENCES "template_condition_branches"("id");
--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "template_item_node_type_check" CHECK ("node_type" IN ('step', 'condition_group'));
--> statement-breakpoint
ALTER TABLE "template_items" ADD CONSTRAINT "conditional_group_no_repeat" CHECK ("node_type" = 'step' OR "repeat_variable_id" IS NULL);
--> statement-breakpoint
CREATE INDEX "template_branches_group_idx" ON "template_condition_branches" ("group_item_id", "deleted_at", "position");
