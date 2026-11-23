CREATE TABLE "organization_logos" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"image" "bytea" NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "organization_logo_mime_check" CHECK ("organization_logos"."mime_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "organization_logo_size_check" CHECK (octet_length("organization_logos"."image") between 1 and 1048576)
);
--> statement-breakpoint
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;