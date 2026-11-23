import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { and, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { checklists } from "@/db/schema";
import { checklistPath } from "@/lib/organization-paths";
export const dynamic = "force-dynamic";
export default async function Checklist({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    user = await signedInPage(`/checklists/${id}`);
  if (!z.uuid().safeParse(id).success || !hasDatabase()) notFound();
  const [data] = await getDatabase().select({ organizationId: checklists.organizationId }).from(checklists)
    .where(and(eq(checklists.id, id), user.role === "admin" ? undefined : isNull(checklists.deletedAt))).limit(1);
  if (!data) notFound();
  redirect(checklistPath(data.organizationId, id));
}
