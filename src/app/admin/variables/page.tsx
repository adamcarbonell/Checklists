import { redirect } from "next/navigation";
import { asc, isNull } from "drizzle-orm";
import { AdminShell } from "@/components/admin-shell";
import { VariableMappingEditor } from "@/components/variable-mapping-editor";
import { getDatabase, hasDatabase } from "@/db/client";
import { variableDefinitions } from "@/db/schema";
import { currentUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export default async function VariablesPage() {
  const user = await currentUser();
  if (!user) redirect("/api/auth/signin?callbackUrl=/admin/variables");
  if (user.role !== "admin") redirect("/");
  const available = hasDatabase();
  const definitions = available
    ? await getDatabase()
        .select()
        .from(variableDefinitions)
        .where(isNull(variableDefinitions.deletedAt))
        .orderBy(asc(variableDefinitions.key))
    : [];
  return (
    <AdminShell
      title="Organization variables"
      description="Approve the exact IT Glue traits retained by the application"
    >
      {available ? (
        <VariableMappingEditor initial={definitions} />
      ) : (
        <p className="rounded-xl border bg-amber-50 p-5 text-sm">
          Database unavailable. No sample mappings or validation results have
          been substituted.
        </p>
      )}
    </AdminShell>
  );
}
