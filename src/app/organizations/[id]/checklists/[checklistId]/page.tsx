import { notFound } from "next/navigation";
import { z } from "zod";
import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { loadChecklist } from "@/lib/checklist-service";
import { loadChecklistFolders } from "@/lib/checklist-folders";
import { checklistPath } from "@/lib/organization-paths";
import { ChecklistRun } from "@/components/checklist-run";

export const dynamic = "force-dynamic";
export default async function Checklist({ params }: { params: Promise<{ id: string; checklistId: string }> }) {
  const { id, checklistId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(checklistId).success || !hasDatabase()) notFound();
  const user = await signedInPage(checklistPath(id, checklistId));
  const data = await loadChecklist(checklistId, user.role === "admin", id);
  if (!data) notFound();
  return <ChecklistRun key={checklistId} initial={data} folders={await loadChecklistFolders(id)} user={user} />;
}
