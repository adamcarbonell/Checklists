import { notFound } from "next/navigation";
import { z } from "zod";
import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { loadOrganizations, loadTemplates } from "@/lib/workspace-data";
import { TemplateCatalog } from "@/components/template-catalog";
export const dynamic = "force-dynamic";
export default async function Organization({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    user = await signedInPage(`/organizations/${id}`);
  if (!z.uuid().safeParse(id).success || !hasDatabase()) notFound();
  const organizations = await loadOrganizations(),
    organization = organizations.find((org) => org.id === id);
  if (!organization) notFound();
  const [rows, globals] = await Promise.all([
    loadTemplates({
      scope: "organization",
      organizationId: id,
      includeDeleted: true,
    }),
    loadTemplates({ scope: "global" }),
  ]);
  return (
    <TemplateCatalog
      key={id}
      initial={rows}
      globals={globals}
      organization={organization}
      user={user}
    />
  );
}
