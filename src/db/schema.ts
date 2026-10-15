import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Comparison } from "@/lib/conditional-types";

export const roleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const cardinalityEnum = pgEnum("variable_cardinality", [
  "scalar",
  "list",
]);
export const validationEnum = pgEnum("validation_status", [
  "valid",
  "invalid",
  "stale",
  "pending",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entraSubject: text("entra_subject").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    role: roleEnum("role").notNull().default("viewer"),
    disabled: boolean("disabled").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_entra_subject_uidx").on(table.entraSubject),
    uniqueIndex("users_email_uidx").on(table.email),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itglueId: text("itglue_id").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncStatus: validationEnum("last_sync_status")
      .notNull()
      .default("pending"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organizations_itglue_id_uidx").on(table.itglueId),
    index("organizations_enabled_idx").on(table.enabled, table.deletedAt),
  ],
);

export type SelectedField = {
  sourceKey: string;
  alias: string;
  expectedKind: string;
};
export type ValidationRules = {
  exactRecords?: number;
  minItems?: number;
  maxItems?: number;
  requiredFields?: string[];
  sortBy?: string;
};

export const variableDefinitions = pgTable(
  "variable_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    assetTypeId: text("asset_type_id").notNull(),
    assetTypeName: text("asset_type_name").notNull(),
    cardinality: cardinalityEnum("cardinality").notNull(),
    selectedFields: jsonb("selected_fields").$type<SelectedField[]>().notNull(),
    validationRules: jsonb("validation_rules")
      .$type<ValidationRules>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    schemaValid: boolean("schema_valid").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("variable_definitions_key_uidx").on(table.key),
    index("variable_definitions_type_idx").on(table.assetTypeId, table.enabled),
  ],
);

export const organizationVariableValues = pgTable(
  "organization_variable_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => variableDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value").$type<unknown>(),
    status: validationEnum("status").notNull().default("pending"),
    issues: jsonb("issues").$type<string[]>().notNull().default([]),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    lastGoodAt: timestamp("last_good_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("org_variable_value_uidx").on(
      table.organizationId,
      table.definitionId,
    ),
    index("org_variable_status_idx").on(table.organizationId, table.status),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    scope: text("scope")
      .$type<"global" | "organization">()
      .notNull()
      .default("global"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    globalTemplateId: uuid("global_template_id").references(
      (): AnyPgColumn => templates.id,
    ),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("templates_active_idx").on(table.deletedAt, table.name),
    index("templates_org_idx").on(table.organizationId),
    check(
      "template_scope_check",
      sql`(${table.scope} = 'global' AND ${table.organizationId} IS NULL AND ${table.globalTemplateId} IS NULL) OR (${table.scope} = 'organization' AND ${table.organizationId} IS NOT NULL AND ${table.globalTemplateId} IS NOT NULL AND ${table.globalTemplateId} <> ${table.id})`,
    ),
  ],
);

export const templateItems = pgTable(
  "template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    nodeType: text("node_type").$type<"step" | "condition_group">().notNull().default("step"),
    parentBranchId: uuid("parent_branch_id").references((): AnyPgColumn => templateBranches.id),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    repeatVariableId: uuid("repeat_variable_id").references(
      () => variableDefinitions.id,
    ),
    anchorItemId: uuid("anchor_item_id"),
    placement: text("placement").$type<"start" | "end" | "before" | "after">(),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("template_items_order_idx").on(
      table.templateId,
      table.position,
      table.deletedAt,
    ),
    check(
      "step_placement_check",
      sql`${table.placement} IS NULL OR ${table.placement} IN ('start', 'end', 'before', 'after')`,
    ),
    check("template_item_node_type_check", sql`${table.nodeType} IN ('step', 'condition_group')`),
    check("conditional_group_no_repeat", sql`${table.nodeType} = 'step' OR ${table.repeatVariableId} IS NULL`),
  ],
);

export const templateBranches = pgTable("template_condition_branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupItemId: uuid("group_item_id").notNull().references(() => templateItems.id),
  position: integer("position").notNull(),
  condition: jsonb("condition").$type<Comparison | null>(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("template_branches_group_idx").on(table.groupItemId, table.deletedAt, table.position)]);

export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    organizationName: text("organization_name").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id),
    templateName: text("template_name").notNull(),
    globalTemplateId: uuid("global_template_id")
      .notNull()
      .references(() => templates.id),
    templateVersion: integer("template_version").notNull(),
    globalTemplateVersion: integer("global_template_version").notNull(),
    variableSnapshot: jsonb("variable_snapshot")
      .$type<Record<string, { value: unknown; syncedAt: string | null }>>()
      .notNull(),
    status: text("status")
      .$type<"active" | "completed">()
      .notNull()
      .default("active"),
    creationKey: uuid("creation_key").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("checklists_creation_uidx").on(
      table.createdBy,
      table.creationKey,
    ),
    index("checklists_org_status_idx").on(
      table.organizationId,
      table.status,
      table.deletedAt,
    ),
    check(
      "checklist_status_check",
      sql`${table.status} IN ('active', 'completed')`,
    ),
  ],
);

export const checklistSteps = pgTable(
  "checklist_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => checklists.id),
    sourceItemId: uuid("source_item_id").notNull(),
    repeatIndex: integer("repeat_index"),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<"pending" | "completed" | "skipped">()
      .notNull()
      .default("pending"),
    notes: text("notes").notNull().default(""),
    skipReason: text("skip_reason").notNull().default(""),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    notesChangedBy: uuid("notes_changed_by").references(() => users.id),
    notesChangedAt: timestamp("notes_changed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("checklist_steps_order_idx").on(table.checklistId, table.position),
    check(
      "checklist_step_status_check",
      sql`${table.status} IN ('pending', 'completed', 'skipped') AND length(${table.notes}) <= 2000 AND length(${table.skipReason}) <= 2000 AND (${table.status} <> 'skipped' OR length(trim(${table.skipReason})) > 0)`,
    ),
  ],
);

export const checklistActivity = pgTable(
  "checklist_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => checklists.id),
    stepId: uuid("step_id").references(() => checklistSteps.id),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    event: text("event").notNull(),
    changes: jsonb("changes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("checklist_activity_idx").on(table.checklistId, table.createdAt),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("revisions_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  trigger: text("trigger").notNull(),
  status: validationEnum("status").notNull().default("pending"),
  requestCount: integer("request_count").notNull().default(0),
  issueSummary: jsonb("issue_summary").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_created_idx").on(table.createdAt),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
  ],
);
