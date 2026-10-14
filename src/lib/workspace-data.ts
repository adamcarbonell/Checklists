import { and, asc, eq, isNull } from "drizzle-orm";
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
  templates,
  variableDefinitions,
} from "@/db/schema";
import {
  extractVariableKeys,
  renderTemplate,
  type RichNode,
  type TemplateItem,
} from "./template-engine";
import type {
  WorkspaceData,
  WorkspaceStep,
  TemplateContext,
  ContextVariable,
  TemplateSummary,
} from "./workspace-types";
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
    })
    .from(variableDefinitions)
    .where(isNull(variableDefinitions.deletedAt))
    .orderBy(asc(variableDefinitions.key))
    .limit(1000);
  return definitions.map(({ selectedFields, ...definition }) => ({
    ...definition,
    fieldAliases: selectedFields.map((field) => field.alias),
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
  const usedKeys = new Set(
    workspace.steps
      .flatMap((step) => [
        ...extractVariableKeys(step.title),
        ...extractVariableKeys(step.body),
        ...(step.repeat ? [step.repeat] : []),
      ])
      .filter((key) => !key.startsWith("item."))
      .map((key) =>
        workspace.definitions.find(
          (definition) =>
            key === definition.key || key.startsWith(`${definition.key}.`),
        )?.key ?? key,
      ),
  );
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
        used: usedKeys.has(definition.key),
      };
    },
  );
  const values: Record<string, unknown> = {};
  for (const variable of variables)
    setPath(values, variable.key, variable.value);
  const items: TemplateItem[] = workspace.steps.map((step) =>
    step.kind === "global"
      ? {
          id: step.id,
          kind: "global",
          position: step.position,
          title: step.title,
          body: step.body,
          repeatVariableKey: step.repeat,
        }
      : {
          id: step.id,
          kind: "organization",
          organizationId,
          position: step.position,
          title: step.title,
          body: step.body,
          repeatVariableKey: step.repeat,
          anchorItemId: step.anchorItemId,
          placement: step.placement,
        },
  );
  const rendered = renderTemplate(items, organizationId, values);
  // Validate field references against the approved mapping even when a list is
  // empty. No record lookup can prove that an unknown alias is permitted.
  const fieldIssues = workspace.steps.flatMap((step) => {
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
    ...workspace.steps
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
