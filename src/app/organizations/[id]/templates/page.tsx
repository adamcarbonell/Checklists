import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { hasDatabase } from "@/db/client";
import { signedInPage } from "@/lib/page-access";
import { loadOrganization, loadTemplates } from "@/lib/workspace-data";
import { organizationPath } from "@/lib/organization-paths";
import { TemplateCatalog } from "@/components/template-catalog";

export const dynamic = "force-dynamic";
export default async function OrganizationTemplates({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || !hasDatabase()) notFound();
  const path = organizationPath(id);
  const user = await signedInPage(`${path}/templates`);
  if (user.role === "viewer") redirect(path);
  const organization = await loadOrganization(id);
  if (!organization) notFound();
  const [initial, globals] = await Promise.all([
    loadTemplates({ scope: "organization", organizationId: id, includeDeleted: true }),
    loadTemplates({ scope: "global" }),
  ]);
  return <TemplateCatalog key={id} initial={initial} globals={globals} organization={organization} user={user} />;
}
