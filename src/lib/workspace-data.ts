import { and, asc, eq, isNull } from "drizzle-orm";
import { getDatabase, hasDatabase } from "@/db/client";
import {
  globalSteps,
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
} from "./workspace-types";

export async function loadWorkspace(
  templateId?: string,
): Promise<WorkspaceData | null> {
  if (!hasDatabase()) return null;
  const db = getDatabase();
  const templateList = await db
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(isNull(templates.deletedAt))
    .orderBy(asc(templates.name));
  const wanted = templateId ?? templateList[0]?.id;
  if (!wanted) return null;
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, wanted), isNull(templates.deletedAt)))
    .limit(1);
  if (!template) return null;
  const [orgs, rows, globals, definitions] = await Promise.all([
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        and(eq(organizations.enabled, true), isNull(organizations.deletedAt)),
      )
      .orderBy(asc(organizations.name))
      .limit(1000),
    db
      .select()
      .from(templateItems)
      .where(
        and(
          eq(templateItems.templateId, template.id),
          isNull(templateItems.deletedAt),
        ),
      )
      .orderBy(asc(templateItems.position)),
    db.select().from(globalSteps).where(isNull(globalSteps.deletedAt)),
    db
      .select({
        id: variableDefinitions.id,
        key: variableDefinitions.key,
        label: variableDefinitions.label,
        cardinality: variableDefinitions.cardinality,
        schemaValid: variableDefinitions.schemaValid,
        enabled: variableDefinitions.enabled,
      })
      .from(variableDefinitions)
      .where(isNull(variableDefinitions.deletedAt))
      .orderBy(asc(variableDefinitions.key)),
  ]);
  const globalMap = new Map(globals.map((s) => [s.id, s]));
  const repeatMap = new Map(definitions.map((d) => [d.id, d.key]));
  const steps: WorkspaceStep[] = rows.map((row) => {
    const source = row.globalStepId
      ? globalMap.get(row.globalStepId)
      : undefined;
    const repeatVariableId =
      row.kind === "global"
        ? (source?.repeatVariableId ?? null)
        : row.snapshotRepeatVariableId;
    return {
      id: row.id,
      sourceId: row.globalStepId ?? row.sourceOrganizationStepId,
      title:
        row.kind === "global"
          ? (source?.title ?? "Unavailable global step")
          : (row.snapshotTitle ?? "Untitled organization step"),
      body: ((row.kind === "global"
        ? source?.body
        : row.snapshotBody) as RichNode) ?? { type: "doc", content: [] },
      kind: row.kind === "global" ? "global" : "org",
      position: row.position,
      organizationId: row.organizationId,
      anchorItemId: row.anchorItemId,
      placement: row.placement,
      repeatVariableId,
      repeat: repeatVariableId ? repeatMap.get(repeatVariableId) : undefined,
      sourceMissing: row.kind === "global" && !source,
    };
  });
  return {
    templateId: template.id,
    templateName: template.name,
    templateDescription: template.description ?? "",
    steps,
    organizations: orgs,
    definitions,
    templates: templateList,
    globalCount: globals.length,
  };
}

export async function loadTemplateContext(
  templateId: string,
  organizationId: string,
): Promise<TemplateContext | null> {
  const workspace = await loadWorkspace(templateId);
  if (
    !workspace ||
    !workspace.organizations.some((o) => o.id === organizationId)
  )
    return null;
  const stored = await getDatabase()
    .select()
    .from(organizationVariableValues)
    .where(eq(organizationVariableValues.organizationId, organizationId));
  const byDefinition = new Map(stored.map((v) => [v.definitionId, v]));
  const approvedFields = await getDatabase()
    .select({
      id: variableDefinitions.id,
      fields: variableDefinitions.selectedFields,
    })
    .from(variableDefinitions)
    .where(isNull(variableDefinitions.deletedAt));
  const fieldMap = new Map(
    approvedFields.map((d) => [d.id, d.fields.map((f) => f.alias)]),
  );
  const applicable = workspace.steps.filter(
    (s) => s.kind === "global" || s.organizationId === organizationId,
  );
  const usedKeys = new Set(
    applicable
      .flatMap((s) => [
        ...extractVariableKeys(s.title),
        ...extractVariableKeys(s.body),
        ...(s.repeat ? [s.repeat] : []),
      ])
      .filter((k) => !k.startsWith("item.")),
  );
  const variables: ContextVariable[] = workspace.definitions.map((d) => {
    const row = byDefinition.get(d.id);
    const stale =
      !!row?.syncedAt && Date.now() - row.syncedAt.getTime() > 86400000;
    const overLimit = Array.isArray(row?.value) && row.value.length > 1000;
    const malformedList =
      d.cardinality === "list" &&
      row?.value != null &&
      (!Array.isArray(row.value) ||
        row.value.some(
          (item) => !item || typeof item !== "object" || Array.isArray(item),
        ));
    const status =
      !d.enabled || !d.schemaValid || overLimit || malformedList
        ? "invalid"
        : stale
          ? "stale"
          : !row?.syncedAt
            ? "pending"
            : (row?.status ?? "pending");
    return {
      ...d,
      value: projectValue(
        overLimit || malformedList ? null : (row?.value ?? null),
        d.cardinality,
        fieldMap.get(d.id) ?? [],
      ),
      status,
      issues: [
        ...(row?.issues ?? []),
        ...(!d.enabled ? ["definition_disabled"] : []),
        ...(!d.schemaValid ? ["schema_incompatible"] : []),
        ...(stale ? ["last_refresh_over_24_hours"] : []),
        ...(overLimit ? ["record_limit_exceeded"] : []),
        ...(malformedList ? ["malformed_normalized_list"] : []),
      ],
      syncedAt: row?.syncedAt?.toISOString() ?? null,
      used: usedKeys.has(d.key),
    };
  });
  const values: Record<string, unknown> = {};
  for (const variable of variables)
    setPath(values, variable.key, variable.value);
  const items: TemplateItem[] = applicable.map((s) =>
    s.kind === "global"
      ? {
          id: s.id,
          kind: "global",
          position: s.position,
          title: s.title,
          body: s.body,
          repeatVariableKey: s.repeat,
        }
      : {
          id: s.id,
          kind: "organization",
          organizationId: s.organizationId!,
          position: s.position,
          anchorItemId: s.anchorItemId,
          placement: s.placement,
          title: s.title,
          body: s.body,
          repeatVariableKey: s.repeat,
        },
  );
  const rendered = renderTemplate(items, organizationId, values);
  const invalidVariables = [
    ...new Set([
      ...variables
        .filter((v) => v.used && v.status !== "valid")
        .map((v) => v.key),
      ...Array.from(usedKeys).filter(
        (k) => !variables.some((v) => v.key === k),
      ),
    ]),
  ];
  const issues = [
    ...rendered.issues,
    ...applicable
      .filter((s) => s.sourceMissing)
      .map((s) => ({ code: "missing_source" as const, itemId: s.id })),
    ...applicable
      .filter(
        (s) =>
          s.repeatVariableId &&
          !workspace.definitions.some(
            (d) =>
              d.id === s.repeatVariableId &&
              d.enabled &&
              d.cardinality === "list",
          ),
      )
      .map((s) => ({
        code: "invalid_list" as const,
        itemId: s.id,
        variableKey: s.repeat,
      })),
  ];
  return {
    organizationId,
    variables,
    issues,
    invalidVariables,
    valid: issues.length === 0 && invalidVariables.length === 0,
    steps: rendered.steps,
  };
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current = root;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) current[part] = value;
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
  const project = (row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    return Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => aliases.includes(key) || key === "id",
      ),
    );
  };
  return cardinality === "list" && Array.isArray(value)
    ? value.map(project)
    : project(value);
}

export async function loadLibrary() {
  const db = getDatabase();
  const [steps, links] = await Promise.all([
    db.select().from(globalSteps).orderBy(asc(globalSteps.title)),
    db
      .select({
        stepId: templateItems.globalStepId,
        id: templates.id,
        name: templates.name,
      })
      .from(templateItems)
      .innerJoin(templates, eq(templates.id, templateItems.templateId))
      .where(and(isNull(templateItems.deletedAt), isNull(templates.deletedAt))),
  ]);
  return steps.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body as RichNode,
    repeatVariableId: s.repeatVariableId,
    deletedAt: s.deletedAt?.toISOString() ?? null,
    references: Array.from(
      new Map(
        links
          .filter((l) => l.stepId === s.id)
          .map((l) => [l.id, { id: l.id, name: l.name }]),
      ).values(),
    ),
  }));
}
export async function loadDefinitions() {
  return getDatabase()
    .select({
      id: variableDefinitions.id,
      key: variableDefinitions.key,
      label: variableDefinitions.label,
      cardinality: variableDefinitions.cardinality,
      schemaValid: variableDefinitions.schemaValid,
      enabled: variableDefinitions.enabled,
    })
    .from(variableDefinitions)
    .where(isNull(variableDefinitions.deletedAt))
    .orderBy(asc(variableDefinitions.key));
}
