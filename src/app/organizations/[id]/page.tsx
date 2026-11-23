import { OrganizationChecklistsPage } from "@/components/organization-checklists-page";

export const dynamic = "force-dynamic";
export default async function Organization({ params }: { params: Promise<{ id: string }> }) {
  return <OrganizationChecklistsPage id={(await params).id} />;
}
