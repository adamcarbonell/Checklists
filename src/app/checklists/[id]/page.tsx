import { notFound } from "next/navigation";
import { z } from "zod";
import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { loadChecklist } from "@/lib/checklist-service";
import { ChecklistRun } from "@/components/checklist-run";
export const dynamic = "force-dynamic";
export default async function Checklist({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    user = await signedInPage(`/checklists/${id}`);
  if (!z.uuid().safeParse(id).success || !hasDatabase()) notFound();
  const data = await loadChecklist(id, user.role === "admin");
  if (!data) notFound();
  return <ChecklistRun key={id} initial={data} user={user} />;
}
