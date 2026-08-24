import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDatabase, hasDatabase } from "@/db/client";
import { globalSteps, organizations, templateItems, templates, variableDefinitions } from "@/db/schema";
import { mergeTemplateItems, type RichNode, type TemplateItem } from "./template-engine";
import type { WorkspaceData } from "@/components/checklist-workspace";

export async function loadWorkspace(): Promise<WorkspaceData | null> {
  if (!hasDatabase()) return null;
  const db = getDatabase();
  const [template] = await db.select().from(templates).where(isNull(templates.deletedAt)).orderBy(asc(templates.name)).limit(1);
  if (!template) return null;
  const enabledOrganizations = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.enabled, true), isNull(organizations.deletedAt))).orderBy(asc(organizations.name)).limit(1000);
  const rows = await db.select().from(templateItems).where(and(eq(templateItems.templateId, template.id), isNull(templateItems.deletedAt))).orderBy(asc(templateItems.position));
  const globalIds = rows.flatMap((row) => row.globalStepId ? [row.globalStepId] : []);
  const globals = globalIds.length ? await db.select().from(globalSteps).where(inArray(globalSteps.id, globalIds)) : [];
  const globalMap = new Map(globals.map((step) => [step.id, step]));
  const repeatIds = [...globals.flatMap((step) => step.repeatVariableId ? [step.repeatVariableId] : []), ...rows.flatMap((row) => row.snapshotRepeatVariableId ? [row.snapshotRepeatVariableId] : [])];
  const definitions = repeatIds.length ? await db.select({ id: variableDefinitions.id, key: variableDefinitions.key }).from(variableDefinitions).where(inArray(variableDefinitions.id, repeatIds)) : [];
  const repeatMap = new Map(definitions.map((definition) => [definition.id, definition.key]));
  const engineItems: TemplateItem[] = [];
  for (const row of rows) {
    if (row.kind === "global") {
      const source = row.globalStepId ? globalMap.get(row.globalStepId) : undefined;
      if (source && !source.deletedAt) engineItems.push({ id: row.id, kind: "global", position: row.position, title: source.title, body: source.body as RichNode, repeatVariableKey: source.repeatVariableId ? repeatMap.get(source.repeatVariableId) : undefined });
    } else if (row.organizationId && row.snapshotTitle && row.snapshotBody) engineItems.push({ id: row.id, kind: "organization", organizationId: row.organizationId, anchorItemId: row.anchorItemId, placement: row.placement, position: row.position, title: row.snapshotTitle, body: row.snapshotBody as RichNode, repeatVariableKey: row.snapshotRepeatVariableId ? repeatMap.get(row.snapshotRepeatVariableId) : undefined });
  }
  const selectedOrgId = enabledOrganizations[0]?.id;
  const ordered = selectedOrgId ? mergeTemplateItems(engineItems, selectedOrgId).items : engineItems.filter((item) => item.kind === "global");
  return {
    templateId: template.id,
    templateName: template.name,
    templateDescription: template.description ?? "",
    organizations: enabledOrganizations,
    steps: ordered.map((item) => {
      const row = rows.find((entry) => entry.id === item.id)!;
      return { id: item.id, itemId: item.id, sourceId: item.kind === "global" ? row.globalStepId ?? undefined : row.sourceOrganizationStepId ?? item.id, title: item.title, body: item.body, kind: item.kind === "global" ? "global" : "org", repeat: item.repeatVariableKey ?? undefined };
    }),
  };
}
