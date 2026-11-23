import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDatabase, type DatabaseTransaction } from "@/db/client";
import { checklistFolders, checklists, organizations } from "@/db/schema";
import { recordAudit } from "./audit";
import { OrderError } from "./template-order";

export async function loadChecklistFolders(organizationId: string) {
  return getDatabase().select({ id: checklistFolders.id, name: checklistFolders.name })
    .from(checklistFolders).where(eq(checklistFolders.organizationId, organizationId))
    .orderBy(asc(sql`lower(${checklistFolders.name})`), asc(checklistFolders.id));
}

export async function requireChecklistFolder(
  organizationId: string, folderId: string, db = getDatabase(),
) {
  const [folder] = await db.select({ id: checklistFolders.id, name: checklistFolders.name })
    .from(checklistFolders).where(folderScope(organizationId, folderId)).limit(1);
  if (!folder) throw new OrderError("folder_not_found", 404);
  return folder;
}

export async function lockChecklistFolder(tx: DatabaseTransaction, orgId: string, folderId: string) {
  const [folder] = await tx.select().from(checklistFolders)
    .where(folderScope(orgId, folderId)).for("update");
  if (!folder) throw new OrderError("folder_not_found", 404);
  return folder;
}

function folderScope(orgId: string, folderId: string) {
  return and(eq(checklistFolders.organizationId, orgId), eq(checklistFolders.id, folderId));
}

export async function changeChecklistFolder(
  organizationId: string,
  change: { action: "create"; name: string } | { action: "rename"; id: string; name: string } | { action: "delete"; id: string },
  actorUserId: string,
) {
  try {
    return await getDatabase().transaction(async (tx) => {
      const [org] = await tx.select({ id: organizations.id }).from(organizations).where(and(
        eq(organizations.id, organizationId), eq(organizations.enabled, true), isNull(organizations.deletedAt),
      ));
      if (!org) throw new OrderError("organization_not_found", 404);
      let folder;
      if (change.action === "create") {
        [folder] = await tx.insert(checklistFolders).values({ organizationId, name: change.name }).returning();
      } else {
        folder = await lockChecklistFolder(tx, organizationId, change.id);
        if (change.action === "rename") {
          [folder] = await tx.update(checklistFolders).set({ name: change.name, updatedAt: new Date() })
            .where(folderScope(organizationId, change.id)).returning();
        } else {
          const [occupant] = await tx.select({ id: checklists.id }).from(checklists).where(and(
            eq(checklists.organizationId, organizationId), eq(checklists.folderId, folder.id),
          )).limit(1);
          if (occupant) throw new OrderError("folder_not_empty", 409);
          await tx.delete(checklistFolders).where(folderScope(organizationId, change.id));
        }
      }
      await recordAudit({ actorUserId, eventType: `checklist_folder.${change.action}`,
        entityType: "checklist_folder", entityId: folder.id,
        details: { organizationId, name: folder.name } }, tx);
      return { id: folder.id, name: folder.name };
    });
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    const code = failure.cause?.code ?? failure.code;
    if (code === "23505") throw new OrderError("folder_name_taken", 409);
    if (code === "23503" && change.action === "delete") throw new OrderError("folder_not_empty", 409);
    throw error;
  }
}
