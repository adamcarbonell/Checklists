CREATE OR REPLACE FUNCTION "public"."seed_organization_checklist_folders"(org_id uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "public"."checklist_folders" ("organization_id", "name")
  VALUES (org_id, 'User Onboardings'), (org_id, 'Computer Onboardings'),
    (org_id, 'Computer Offboardings'), (org_id, 'User Offboardings')
  ON CONFLICT DO NOTHING;
$$;
--> statement-breakpoint
UPDATE "public"."checklist_folders" AS folder
SET "name" = names.plural, "updated_at" = now()
FROM (VALUES
  ('New Employee', 'User Onboardings'),
  ('New Computer', 'Computer Onboardings'),
  ('Computer Offboarding', 'Computer Offboardings'),
  ('User Offboarding', 'User Offboardings')
) AS names(singular, plural)
WHERE folder."name" = names.singular
  AND NOT EXISTS (
    SELECT 1 FROM "public"."checklist_folders" AS existing
    WHERE existing."organization_id" = folder."organization_id"
      AND lower(existing."name") = lower(names.plural)
  );
