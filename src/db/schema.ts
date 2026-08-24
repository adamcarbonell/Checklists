import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const cardinalityEnum = pgEnum("variable_cardinality", ["scalar", "list"]);
export const validationEnum = pgEnum("validation_status", ["valid", "invalid", "stale", "pending"]);
export const itemKindEnum = pgEnum("template_item_kind", ["global", "organization"]);
export const placementEnum = pgEnum("item_placement", ["before", "after"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  entraSubject: text("entra_subject").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  role: roleEnum("role").notNull().default("viewer"),
  disabled: boolean("disabled").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("users_entra_subject_uidx").on(table.entraSubject), uniqueIndex("users_email_uidx").on(table.email)]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  itglueId: text("itglue_id").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncStatus: validationEnum("last_sync_status").notNull().default("pending"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("organizations_itglue_id_uidx").on(table.itglueId), index("organizations_enabled_idx").on(table.enabled, table.deletedAt)]);

export type SelectedField = { sourceKey: string; alias: string; expectedKind: string };
export type ValidationRules = { exactRecords?: number; minItems?: number; maxItems?: number; requiredFields?: string[]; sortBy?: string };

export const variableDefinitions = pgTable("variable_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  assetTypeId: text("asset_type_id").notNull(),
  assetTypeName: text("asset_type_name").notNull(),
  cardinality: cardinalityEnum("cardinality").notNull(),
  selectedFields: jsonb("selected_fields").$type<SelectedField[]>().notNull(),
  validationRules: jsonb("validation_rules").$type<ValidationRules>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  schemaValid: boolean("schema_valid").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("variable_definitions_key_uidx").on(table.key), index("variable_definitions_type_idx").on(table.assetTypeId, table.enabled)]);

export const organizationVariableValues = pgTable("organization_variable_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  definitionId: uuid("definition_id").notNull().references(() => variableDefinitions.id, { onDelete: "cascade" }),
  value: jsonb("value").$type<unknown>(),
  status: validationEnum("status").notNull().default("pending"),
  issues: jsonb("issues").$type<string[]>().notNull().default([]),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  lastGoodAt: timestamp("last_good_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("org_variable_value_uidx").on(table.organizationId, table.definitionId), index("org_variable_status_idx").on(table.organizationId, table.status)]);

export const globalSteps = pgTable("global_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  repeatVariableId: uuid("repeat_variable_id").references(() => variableDefinitions.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("global_steps_active_idx").on(table.deletedAt)]);

export const organizationSteps = pgTable("organization_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  repeatVariableId: uuid("repeat_variable_id").references(() => variableDefinitions.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("organization_steps_org_idx").on(table.organizationId, table.deletedAt)]);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("templates_active_idx").on(table.deletedAt, table.name)]);

export const templateItems = pgTable("template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
  kind: itemKindEnum("kind").notNull(),
  globalStepId: uuid("global_step_id").references(() => globalSteps.id),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  sourceOrganizationStepId: uuid("source_organization_step_id").references(() => organizationSteps.id),
  snapshotTitle: text("snapshot_title"),
  snapshotBody: jsonb("snapshot_body").$type<Record<string, unknown>>(),
  snapshotRepeatVariableId: uuid("snapshot_repeat_variable_id").references(() => variableDefinitions.id),
  anchorItemId: uuid("anchor_item_id"),
  placement: placementEnum("placement"),
  position: integer("position").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("template_items_order_idx").on(table.templateId, table.position, table.deletedAt), index("template_items_org_idx").on(table.templateId, table.organizationId)]);

export const revisions = pgTable("revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("revisions_entity_idx").on(table.entityType, table.entityId, table.createdAt)]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  status: validationEnum("status").notNull().default("pending"),
  requestCount: integer("request_count").notNull().default(0),
  issueSummary: jsonb("issue_summary").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_events_created_idx").on(table.createdAt), index("audit_events_entity_idx").on(table.entityType, table.entityId)]);
