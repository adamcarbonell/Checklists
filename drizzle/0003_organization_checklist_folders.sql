CREATE TABLE "checklist_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_folder_name_check" CHECK (char_length("checklist_folders"."name") between 1 and 100 and "checklist_folders"."name" = btrim("checklist_folders"."name"))
);
--> statement-breakpoint
ALTER TABLE "checklists" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "checklist_folders" ADD CONSTRAINT "checklist_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_folders_org_id_uidx" ON "checklist_folders" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_folders_org_name_uidx" ON "checklist_folders" USING btree ("organization_id",lower("name"));--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_org_folder_fk" FOREIGN KEY ("organization_id","folder_id") REFERENCES "public"."checklist_folders"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklists_org_folder_idx" ON "checklists" USING btree ("organization_id","folder_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION "public"."seed_organization_checklist_folders"(org_id uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "public"."checklist_folders" ("organization_id", "name")
  VALUES (org_id, 'New Employee'), (org_id, 'New Computer'),
    (org_id, 'Computer Offboarding'), (org_id, 'User Offboarding')
  ON CONFLICT DO NOTHING;
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."create_organization_checklist_folders"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "public"."seed_organization_checklist_folders"(NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "organizations_create_checklist_folders"
  AFTER INSERT ON "public"."organizations"
  FOR EACH ROW EXECUTE FUNCTION "public"."create_organization_checklist_folders"();
--> statement-breakpoint
SELECT "public"."seed_organization_checklist_folders"("id") FROM "public"."organizations";
