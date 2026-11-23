import { notFound } from "next/navigation";
import { z } from "zod";
import { hasDatabase } from "@/db/client";
import { signedInPage } from "@/lib/page-access";
import { loadOrganization, loadTemplates } from "@/lib/workspace-data";
import { loadChecklistFolders } from "@/lib/checklist-folders";
import { listChecklists } from "@/lib/checklist-service";
import { organizationPath } from "@/lib/organization-paths";
import { ChecklistBoard } from "./checklist-board";

export async function OrganizationChecklistsPage({ id, folderId }: { id: string; folderId?: string }) {
  if (!z.uuid().safeParse(id).success || (folderId && !z.uuid().safeParse(folderId).success) || !hasDatabase()) notFound();
  const user = await signedInPage(organizationPath(id, folderId));
  const organization = await loadOrganization(id);
  if (!organization) notFound();
  const folders = await loadChecklistFolders(id);
  const folder = folders.find((entry) => entry.id === folderId);
  if (folderId && !folder) notFound();
  const [initial, templates] = await Promise.all([
    listChecklists({ organizationId: id, folderId }),
    loadTemplates({ scope: "organization", organizationId: id }),
  ]);
  return <ChecklistBoard key={folderId ?? id} initial={initial} organization={organization} folders={folders} folder={folder} templates={templates} user={user} />;
}
