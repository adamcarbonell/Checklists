import { OrganizationChecklistsPage } from "@/components/organization-checklists-page";

export const dynamic = "force-dynamic";
export default async function Folder({ params }: { params: Promise<{ id: string; folderId: string }> }) {
  return <OrganizationChecklistsPage {...await params} />;
}
