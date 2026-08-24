import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { globalSteps, organizationVariableValues, templateItems, variableDefinitions } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { renderTemplate, type RichNode, type TemplateItem } from "@/lib/template-engine";

export async function GET(request: Request, context: RouteContext<"/api/templates/[id]/preview">) {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  const { id } = await context.params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) return Response.json({ error: "organization_id_required" }, { status: 400 });
  const db = getDatabase();
  const rows = await db.select().from(templateItems).where(and(eq(templateItems.templateId, id), isNull(templateItems.deletedAt)));
  const globalIds = rows.map((row) => row.globalStepId).filter((value): value is string => Boolean(value));
  const globals = globalIds.length ? await db.select().from(globalSteps).where(inArray(globalSteps.id, globalIds)) : [];
  const globalMap = new Map(globals.map((step) => [step.id, step]));
  const repeatIds = [...globals.map((step) => step.repeatVariableId), ...rows.map((row) => row.snapshotRepeatVariableId)].filter((value): value is string => Boolean(value));
  const repeatDefinitions = repeatIds.length ? await db.select({ id: variableDefinitions.id, key: variableDefinitions.key }).from(variableDefinitions).where(inArray(variableDefinitions.id, repeatIds)) : [];
  const repeatKeyMap = new Map(repeatDefinitions.map((definition) => [definition.id, definition.key]));
  const items: TemplateItem[] = [];
  for (const row of rows) {
    if (row.kind === "global") {
      const step = row.globalStepId ? globalMap.get(row.globalStepId) : undefined;
      if (step && !step.deletedAt) items.push({ id: row.id, kind: "global", position: row.position, title: step.title, body: step.body as RichNode, repeatVariableKey: step.repeatVariableId ? repeatKeyMap.get(step.repeatVariableId) : undefined });
      continue;
    }
    if (row.organizationId && row.snapshotTitle && row.snapshotBody) items.push({ id: row.id, kind: "organization", organizationId: row.organizationId, anchorItemId: row.anchorItemId, placement: row.placement, position: row.position, title: row.snapshotTitle, body: row.snapshotBody as RichNode, repeatVariableKey: row.snapshotRepeatVariableId ? repeatKeyMap.get(row.snapshotRepeatVariableId) : undefined });
  }
  const valuesRows = await db.select({ key: variableDefinitions.key, value: organizationVariableValues.value, status: organizationVariableValues.status, syncedAt: organizationVariableValues.syncedAt }).from(organizationVariableValues).innerJoin(variableDefinitions, eq(variableDefinitions.id, organizationVariableValues.definitionId)).where(eq(organizationVariableValues.organizationId, organizationId));
  const values: Record<string, unknown> = {};
  const invalidVariables: string[] = [];
  for (const row of valuesRows) {
    if (row.status !== "valid" || !row.syncedAt || Date.now() - row.syncedAt.getTime() > 24 * 60 * 60 * 1000) invalidVariables.push(row.key);
    setPath(values, row.key, row.value);
  }
  const rendered = renderTemplate(items, organizationId, values);
  return Response.json({ data: rendered, validation: { invalidVariables, valid: rendered.valid && invalidVariables.length === 0 } });
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split("."); let current = root;
  parts.forEach((part, index) => { if (index === parts.length - 1) current[part] = value; else { if (!current[part] || typeof current[part] !== "object") current[part] = {}; current = current[part] as Record<string, unknown>; } });
}
