import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/db/client";
import { globalSteps, templateItems, templates, variableDefinitions } from "../src/db/schema";

const paragraph = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function main() {
  const db = getDatabase();
  const definitions = [
    { key: "org.ad_full_name", label: "AD Full Name", description: "Validated Active Directory full name.", assetTypeId: "107504", assetTypeName: "Active Directory", cardinality: "scalar" as const, selectedFields: [{ sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" }], validationRules: { exactRecords: 1, requiredFields: ["value"] } },
    { key: "org.applications", label: "Applications", description: "Approved application names for repeated steps.", assetTypeId: "107505", assetTypeName: "Applications", cardinality: "list" as const, selectedFields: [{ sourceKey: "name", alias: "name", expectedKind: "Text" }], validationRules: { minItems: 0, sortBy: "name", requiredFields: ["name"] } },
  ];
  for (const definition of definitions) await db.insert(variableDefinitions).values(definition).onConflictDoUpdate({ target: variableDefinitions.key, set: { ...definition, enabled: true, schemaValid: true, deletedAt: null, updatedAt: new Date() } });

  const existing = await db.select({ id: templates.id }).from(templates).where(eq(templates.name, "Employee onboarding")).limit(1);
  if (!existing.length) {
    const [template] = await db.insert(templates).values({ name: "Employee onboarding", description: "A consistent onboarding sequence with validated organization context." }).returning();
    const [applicationDefinition] = await db.select({ id: variableDefinitions.id }).from(variableDefinitions).where(eq(variableDefinitions.key, "org.applications")).limit(1);
    const [scope, domain, apps] = await db.insert(globalSteps).values([
      { title: "Confirm the requester and scope", body: paragraph("Verify the requester, requested completion date, and any special access constraints before making changes.") },
      { title: "Verify the Active Directory domain", body: paragraph("Confirm the domain is {{org.ad_full_name}} and record any exceptions in the ticket.") },
      { title: "Review {{item.name}} access", body: paragraph("Confirm licensing, assigned role, and manager approval for {{item.name}}."), repeatVariableId: applicationDefinition.id },
    ]).returning();
    await db.insert(templateItems).values([
      { templateId: template.id, kind: "global", globalStepId: scope.id, position: 100 },
      { templateId: template.id, kind: "global", globalStepId: domain.id, position: 200 },
      { templateId: template.id, kind: "global", globalStepId: apps.id, position: 300 },
    ]);
  }
  console.log("Variable mappings and starter template are ready.");
}

main().then(closeDatabase).catch(async (error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : "unknown error");
  await closeDatabase();
  process.exitCode = 1;
});
