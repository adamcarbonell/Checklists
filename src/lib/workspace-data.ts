import { and, asc, eq, isNull, inArray } from "drizzle-orm";
import {
  getDatabase,
  hasDatabase,
  type Database,
  type DatabaseTransaction,
} from "@/db/client";
import {
  organizations,
  organizationVariableValues,
  templateItems,
  templateBranches,
  templates,
  variableDefinitions,
} from "@/db/schema";
import {
  extractVariableKeys,
  renderTemplate,
  type RichNode,
} from "./template-engine";
import type {
  WorkspaceData,
  WorkspaceStep,
  TemplateContext,
  ContextVariable,
  TemplateSummary,
} from "./workspace-types";
import { conditionFields } from "./conditional-types";
import { workspaceItems } from "./conditional-tree";
type Reader = Database | DatabaseTransaction;
export async function loadOrganizations(db: Reader = getDatabase()) {
  return db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(
      and(eq(organizations.enabled, true), isNull(organizations.deletedAt)),
    )
    .orderBy(asc(organizations.name))
    .limit(1000);
}
export async function loadTemplates(
  filters: {
    scope?: "global" | "organization";
    organizationId?: string;
    includeDeleted?: boolean;
  } = {},
  db: Reader = getDatabase(),
): Promise<TemplateSummary[]> {
  const rows = await db
    .select({
      id: templates.id,
      name: templates.name,
      scope: templates.scope,
      organizationId: templates.organizationId,
      globalTemplateId: templates.globalTemplateId,
      version: templates.version,
      deletedAt: templates.deletedAt,
    })
    .from(templates)
    .where(
      and(
        filters.scope ? eq(templates.scope, filters.scope) : undefined,
        filters.organizationId
          ? eq(templates.organizationId, filters.organizationId)
          : undefined,
        filters.includeDeleted ? undefined : isNull(templates.deletedAt),
      ),
    )
    .orderBy(asc(templates.name))
    .limit(1000);
  return rows.map((row) => ({
    ...row,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}
export async function loadDefinitions(db: Reader = getDatabase()) {
  const definitions = await db
    .select({
      id: variableDefinitions.id,
      key: variableDefinitions.key,
      label: variableDefinitions.label,
      cardinality: variableDefinitions.cardinality,
      schemaValid: variableDefinitions.schemaValid,
      enabled: variableDefinitions.enabled,
      selectedFields: variableDefinitions.selectedFields,
      validationRules: variableDefinitions.validationRules,
    })
    .from(variableDefinitions)
    .where(isNull(variableDefinitions.deletedAt))
    .orderBy(asc(variableDefinitions.key))
    .limit(1000);
  return definitions.map(({ selectedFields, validationRules, ...definition }) => ({
    ...definition,
    fieldAliases: selectedFields.map((field) => field.alias),
    fieldKinds: Object.fromEntries(selectedFields.map((field) => [field.alias, field.expectedKind])),
    requiredFieldAliases: validationRules.requiredFields ?? [],
  }));
}
export async function loadWorkspace(
  templateId: string,
  db: Reader = getDatabase(),
): Promise<WorkspaceData | null> {
  if (!hasDatabase()) return null;
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), isNull(templates.deletedAt)))
    .limit(1);
  if (!template) return null;
  const orgs = await loadOrganizations(db);
  const organization = orgs.find((org) => org.id === template.organizationId);
  if (template.scope === "organization" && !organization) return null;
  let parent: typeof templates.$inferSelect | undefined;
  if (template.globalTemplateId) {
    [parent] = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, template.globalTemplateId),
          eq(templates.scope, "global"),
          isNull(templates.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) return null;
  }
  const definitions = await loadDefinitions(db);
  const rows = await db
    .select()
    .from(templateItems)
    .where(
      and(
        eq(templateItems.templateId, template.id),
        isNull(templateItems.deletedAt),
      ),
    )
    .orderBy(asc(templateItems.position));
  const inherited = parent
    ? await db
        .select()
        .from(templateItems)
        .where(
          and(
            eq(templateItems.templateId, parent.id),
            isNull(templateItems.deletedAt),
          ),
        )
        .orderBy(asc(templateItems.position))
    : [];
  const steps: WorkspaceStep[] = [...inherited, ...rows].map((row) => ({
    nodeType: row.nodeType,
    parentBranchId: row.parentBranchId,
    id: row.id,
    templateId: row.templateId,
    title: row.title,
    body: row.body as RichNode,
    kind:
      row.templateId === template.id && template.scope === "organization"
        ? "org"
        : "global",
    inherited: row.templateId !== template.id,
    position: row.position,
    organizationId:
      row.templateId === template.id ? template.organizationId : null,
    anchorItemId: row.anchorItemId,
    placement: row.placement,
    repeatVariableId: row.repeatVariableId,
    repeat: definitions.find(
      (definition) => definition.id === row.repeatVariableId,
    )?.key,
    version: row.version,
  }));
  const branches = steps.length ? await db.select().from(templateBranches)
    .where(and(inArray(templateBranches.groupItemId, steps.map((step) => step.id)), isNull(templateBranches.deletedAt)))
    .orderBy(asc(templateBranches.position)) : [];
  return {
    templateId: template.id,
    templateName: template.name,
    templateDescription: template.description ?? "",
    scope: template.scope,
    organizationId: template.organizationId,
    organizationName: organization?.name ?? null,
    parent: parent
      ? { id: parent.id, name: parent.name, version: parent.version }
      : null,
    version: template.version,
    steps,
    branches: branches.map((branch) => ({ id: branch.id, groupItemId: branch.groupItemId, position: branch.position,
      condition: branch.condition, inherited: steps.find((step) => step.id === branch.groupItemId)?.inherited ?? false })),
    organizations: orgs,
    definitions,
  };
}
export async function loadTemplateContext(
  templateId: string,
  organizationId: string,
  db: Reader = getDatabase(),
): Promise<TemplateContext | null> {
  const workspace = await loadWorkspace(templateId, db);
  if (
    !workspace ||
    !workspace.organizations.some((org) => org.id === organizationId) ||
    (workspace.scope === "organization" &&
      workspace.organizationId !== organizationId)
  )
    return null;
  const stored = await db
    .select()
    .from(organizationVariableValues)
    .where(eq(organizationVariableValues.organizationId, organizationId));
  const byDefinition = new Map(stored.map((row) => [row.definitionId, row]));
  const variables: ContextVariable[] = workspace.definitions.map(
    (definition) => {
      const row = byDefinition.get(definition.id),
        stale =
          !!row?.syncedAt && Date.now() - row.syncedAt.getTime() > 86400000;
      const overLimit = Array.isArray(row?.value) && row.value.length > 1000;
      const malformed =
        definition.cardinality === "list" &&
        row?.value != null &&
        (!Array.isArray(row.value) ||
          row.value.some(
            (item) => !item || typeof item !== "object" || Array.isArray(item),
          ));
      return {
        ...definition,
        value:
          overLimit || malformed
            ? null
            : projectValue(
                row?.value ?? null,
                definition.cardinality,
                definition.fieldAliases,
              ),
        status:
          !definition.enabled ||
          !definition.schemaValid ||
          overLimit ||
          malformed
            ? "invalid"
            : stale
              ? "stale"
              : !row?.syncedAt
                ? "pending"
                : row.status,
        issues: [
          ...(row?.issues ?? []),
          ...(!definition.enabled ? ["definition_disabled"] : []),
          ...(!definition.schemaValid ? ["schema_incompatible"] : []),
          ...(stale ? ["last_refresh_over_24_hours"] : []),
          ...(overLimit ? ["record_limit_exceeded"] : []),
          ...(malformed ? ["malformed_normalized_list"] : []),
        ],
        syncedAt: row?.syncedAt?.toISOString() ?? null,
        used: false,
      };
    },
  );
  const values: Record<string, unknown> = {};
  for (const variable of variables)
    setPath(values, variable.key, variable.value);
  const items = workspaceItems(workspace.steps, organizationId);
  const applications = variables.find((variable) => variable.key === "org.applications");
  const optionalVersion = applications?.status === "valid" &&
    applications.cardinality === "list" &&
    applications.fieldAliases.includes("version") &&
    !applications.requiredFieldAliases.includes("version");
  const rendered = renderTemplate(items, organizationId, values, {
    branches: workspace.branches,
    conditionFields: conditionFields(workspace.definitions),
    variableStates: Object.fromEntries(variables.map((variable) => [variable.key, variable.status])),
    optionalFieldFallbacks: optionalVersion
      ? { "org.applications": { version: "Not specified" } }
      : undefined,
  });
  const usedKeys = new Set(rendered.usedVariableKeys.filter((key) => !key.startsWith("item."))
    .map((key) => workspace.definitions.find((definition) => key === definition.key || key.startsWith(`${definition.key}.`))?.key ?? key));
  for (const variable of variables) variable.used = usedKeys.has(variable.key);
  const activeSteps = workspace.steps.filter((step) => rendered.activeItemIds.includes(step.id));
  // Validate field references against the approved mapping even when a list is
  // empty. No record lookup can prove that an unknown alias is permitted.
  const fieldIssues = activeSteps.flatMap((step) => {
    const repeated = workspace.definitions.find(
      (definition) => definition.id === step.repeatVariableId,
    );
    return [...new Set([
      ...extractVariableKeys(step.title),
      ...extractVariableKeys(step.body),
    ])].flatMap((key) => {
      const definition = key.startsWith("item.")
        ? repeated
        : workspace.definitions.find(
            (definition) =>
              definition.cardinality === "list" &&
              key.startsWith(`${definition.key}.`),
          );
      if (!definition && !key.startsWith("item.")) return [];
      const alias = key.slice(key.startsWith("item.") ? 5 : definition!.key.length + 1);
      return definition?.cardinality === "list" &&
        repeated?.id === definition.id &&
        (definition.fieldAliases.includes(alias) || alias === "id")
        ? []
        : [{ code: "missing_variable" as const, itemId: step.id, variableKey: key }];
    });
  });
  const invalidVariables = [
    ...new Set([
      ...variables
        .filter((variable) => variable.used && variable.status !== "valid")
        .map((variable) => variable.key),
      ...Array.from(usedKeys).filter(
        (key) => !variables.some((variable) => variable.key === key),
      ),
    ]),
  ];
  const issues = [
    ...rendered.issues,
    ...fieldIssues.filter((issue) => !rendered.issues.some(
      (existing) => existing.itemId === issue.itemId && existing.variableKey === issue.variableKey,
    )),
    ...(!rendered.steps.length
      ? [{ code: "empty_checklist" as const, itemId: templateId }]
      : []),
    ...activeSteps
      .filter(
        (step) =>
          step.repeatVariableId &&
          !workspace.definitions.some(
            (definition) =>
              definition.id === step.repeatVariableId &&
              definition.enabled &&
              definition.cardinality === "list",
          ),
      )
      .map((step) => ({
        code: "invalid_list" as const,
        itemId: step.id,
        variableKey: step.repeat,
      })),
  ];
  return {
    organizationId,
    variables,
    issues,
    invalidVariables,
    valid: issues.length === 0 && invalidVariables.length === 0,
    steps: rendered.steps,
    conditionDecisions: rendered.conditionDecisions,
    templateVersion: workspace.version,
    parentVersion: workspace.parent?.version ?? null,
  };
}
function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = value;
    else {
      if (!current[part] || typeof current[part] !== "object")
        current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  });
}
function projectValue(
  value: unknown,
  cardinality: "scalar" | "list",
  aliases: string[],
): unknown {
  const project = (row: unknown) =>
    !row || typeof row !== "object" || Array.isArray(row)
      ? row
      : Object.fromEntries(
          Object.entries(row).filter(
            ([key]) => aliases.includes(key) || key === "id",
          ),
        );
  return cardinality === "list" && Array.isArray(value)
    ? value.map(project)
    : project(value);
}
