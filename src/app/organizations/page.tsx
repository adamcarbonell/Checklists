import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { loadOrganizations } from "@/lib/workspace-data";
import { OrganizationDirectory } from "@/components/template-catalog";
export const dynamic = "force-dynamic";
export default async function Organizations() {
  const user = await signedInPage("/organizations"),
    organizations = hasDatabase() ? await loadOrganizations() : [];
  return <OrganizationDirectory organizations={organizations} user={user} />;
}
