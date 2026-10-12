import { notFound } from "next/navigation";
import { z } from "zod";
import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { loadWorkspace } from "@/lib/workspace-data";
import { TemplateWorkspace } from "@/components/template-workspace";
export const dynamic = "force-dynamic";
export default async function TemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    user = await signedInPage(`/templates/${id}`);
  if (!z.uuid().safeParse(id).success || !hasDatabase()) notFound();
  const data = await loadWorkspace(id);
  if (!data) notFound();
  return <TemplateWorkspace key={id} initialData={data} user={user} />;
}
