import { redirect } from "next/navigation";
import { asc, isNull } from "drizzle-orm";
import { AdminShell } from "@/components/admin-shell";
import { VariableMappingEditor } from "@/components/variable-mapping-editor";
import { getDatabase, hasDatabase } from "@/db/client";
import { variableDefinitions } from "@/db/schema";
import { currentUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export default async function VariablesPage() {
  const user = await currentUser(); if (!user) redirect("/api/auth/signin?callbackUrl=/admin/variables"); if (user.role !== "admin") redirect("/");
  const definitions = hasDatabase() ? await getDatabase().select().from(variableDefinitions).where(isNull(variableDefinitions.deletedAt)).orderBy(asc(variableDefinitions.key)) : [
    { id: "demo-ad", key: "org.ad_full_name", label: "AD Full Name", description: "", assetTypeId: "107504", assetTypeName: "Active Directory", cardinality: "scalar" as const, selectedFields: [{ sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" }], validationRules: { exactRecords: 1, requiredFields: ["value"] }, enabled: true, schemaValid: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
    { id: "demo-apps", key: "org.applications", label: "Applications", description: "", assetTypeId: "107505", assetTypeName: "Applications", cardinality: "list" as const, selectedFields: [{ sourceKey: "name", alias: "name", expectedKind: "Text" }], validationRules: { minItems: 0, requiredFields: ["name"], sortBy: "name" }, enabled: true, schemaValid: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
  return <AdminShell title="Organization variables" description="Approve the exact IT Glue traits retained by the application"><VariableMappingEditor initial={definitions} /></AdminShell>;
}
