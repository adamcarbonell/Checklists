import { notFound } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDatabase, hasDatabase } from "@/db/client";
import { organizationLogos } from "@/db/schema";
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
  const [initial, templates, [logo]] = await Promise.all([
    listChecklists({ organizationId: id, folderId }),
    loadTemplates({ scope: "organization", organizationId: id }),
    folderId ? [] : getDatabase().select({ version: organizationLogos.version }).from(organizationLogos)
      .where(eq(organizationLogos.organizationId, id)).limit(1),
  ]);
  return <ChecklistBoard key={folderId ?? id} initial={initial} organization={organization} folders={folders} folder={folder} templates={templates} logoVersion={logo?.version} user={user} />;
}
