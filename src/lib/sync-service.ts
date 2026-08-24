import { and, eq, isNull } from "drizzle-orm";
import { auditEvents, organizationVariableValues, organizations, syncRuns, variableDefinitions } from "@/db/schema";
import { getDatabase } from "@/db/client";
import { ItGlueClient, ItGlueLimitError, type RequestPreview } from "./itglue";
import { resolveVariable } from "./variable-validation";

export async function syncOrganization(organizationId: string, trigger: "manual" | "cron", actorUserId?: string) {
  const db = getDatabase();
  const [organization] = await db.select().from(organizations).where(and(eq(organizations.id, organizationId), eq(organizations.enabled, true), isNull(organizations.deletedAt))).limit(1);
  if (!organization) throw new Error("Enabled organization not found.");
  const definitions = await db.select().from(variableDefinitions).where(and(eq(variableDefinitions.enabled, true), eq(variableDefinitions.schemaValid, true), isNull(variableDefinitions.deletedAt)));
  const [run] = await db.insert(syncRuns).values({ organizationId, trigger }).returning();
  let requestCount = 0;
  const issues: string[] = [];

  const recordPreview = async (preview: RequestPreview) => {
    requestCount += 1;
    await db.insert(auditEvents).values({ actorUserId, eventType: "itglue.request.preview", entityType: "organization", entityId: organizationId, details: preview });
  };
  const client = new ItGlueClient({ apiKey: requireServerEnv("ITGLUE_API_KEY"), baseUrl: process.env.ITGLUE_BASE_URL, onRequestPreview: recordPreview });
  const byType = new Map<string, typeof definitions>();
  for (const definition of definitions) {
    const current = byType.get(definition.assetTypeId) ?? [];
    current.push(definition);
    byType.set(definition.assetTypeId, current);
  }

  for (const [assetTypeId, typeDefinitions] of byType) {
    const selectedFields = [...new Map(typeDefinitions.flatMap((definition) => definition.selectedFields).map((field) => [field.sourceKey, field])).values()];
    try {
      const assets = await client.getFlexibleAssets({ organizationId: organization.itglueId, assetTypeId, selectedFields });
      for (const definition of typeDefinitions) {
        const resolution = resolveVariable({ key: definition.key, cardinality: definition.cardinality, selectedFields: definition.selectedFields, validationRules: definition.validationRules }, assets);
        const now = new Date();
        if (resolution.status === "valid") {
          await db.insert(organizationVariableValues).values({ organizationId, definitionId: definition.id, value: resolution.value, status: "valid", issues: [], sourceUpdatedAt: resolution.sourceUpdatedAt, syncedAt: now, lastGoodAt: now })
            .onConflictDoUpdate({ target: [organizationVariableValues.organizationId, organizationVariableValues.definitionId], set: { value: resolution.value, status: "valid", issues: [], sourceUpdatedAt: resolution.sourceUpdatedAt, syncedAt: now, lastGoodAt: now, updatedAt: now } });
        } else {
          await db.insert(organizationVariableValues).values({ organizationId, definitionId: definition.id, status: resolution.status, issues: resolution.issues, sourceUpdatedAt: resolution.sourceUpdatedAt, syncedAt: now })
            .onConflictDoUpdate({ target: [organizationVariableValues.organizationId, organizationVariableValues.definitionId], set: { status: resolution.status, issues: resolution.issues, sourceUpdatedAt: resolution.sourceUpdatedAt, syncedAt: now, updatedAt: now } });
        }
        issues.push(...resolution.issues.map((issue) => `${definition.key}:${issue}`));
      }
    } catch (error) {
      const code = error instanceof ItGlueLimitError ? `asset_type_${assetTypeId}:over_limit_${error.totalCount}` : `asset_type_${assetTypeId}:request_failed`;
      issues.push(code);
      for (const definition of typeDefinitions) await markStale(organizationId, definition.id, code);
    }
  }

  const status = issues.length ? "invalid" : "valid";
  const completedAt = new Date();
  await db.update(syncRuns).set({ status, requestCount, issueSummary: issues, completedAt }).where(eq(syncRuns.id, run.id));
  await db.update(organizations).set({ lastSyncedAt: completedAt, lastSyncStatus: status, updatedAt: completedAt }).where(eq(organizations.id, organizationId));
  return { runId: run.id, status, requestCount, issues };
}

async function markStale(organizationId: string, definitionId: string, issue: string) {
  const db = getDatabase();
  const now = new Date();
  await db.insert(organizationVariableValues).values({ organizationId, definitionId, status: "stale", issues: [issue], syncedAt: now })
    .onConflictDoUpdate({ target: [organizationVariableValues.organizationId, organizationVariableValues.definitionId], set: { status: "stale", issues: [issue], syncedAt: now, updatedAt: now } });
}

function requireServerEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
