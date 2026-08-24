import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { variableDefinitions } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { ItGlueClient } from "@/lib/itglue";
import { errorResponse } from "@/lib/input";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const db = getDatabase();
    const [definition] = await db.select().from(variableDefinitions).where(eq(variableDefinitions.id, id)).limit(1);
    if (!definition) return Response.json({ error: "not_found" }, { status: 404 });
    const client = new ItGlueClient({ apiKey: requiredEnv("ITGLUE_API_KEY"), baseUrl: process.env.ITGLUE_BASE_URL, onRequestPreview: async (preview) => recordAudit({ actorUserId: access.user.id, eventType: "itglue.request.preview", entityType: "variable_definition", entityId: id, details: preview }) });
    const assetType = await client.getFlexibleAssetType(definition.assetTypeId);
    const fieldMap = new Map(assetType.fields.map((field) => [field.key, field]));
    const issues = definition.selectedFields.flatMap((selected) => {
      if (selected.sourceKey === "name") return selected.expectedKind.toLowerCase() === "text" ? [] : ["kind_mismatch:name"];
      const field = fieldMap.get(selected.sourceKey);
      if (!field) return [`missing_field:${selected.sourceKey}`];
      if (["password", "upload"].includes(field.kind.toLowerCase())) return [`disallowed_field_kind:${selected.sourceKey}`];
      if (field.kind && field.kind.toLowerCase() !== selected.expectedKind.toLowerCase()) return [`kind_mismatch:${selected.sourceKey}`];
      return [];
    });
    const schemaValid = issues.length === 0;
    await db.update(variableDefinitions).set({ schemaValid, updatedAt: new Date() }).where(eq(variableDefinitions.id, id));
    await recordAudit({ actorUserId: access.user.id, eventType: "variable_definition.schema_validated", entityType: "variable_definition", entityId: id, details: { assetTypeId: definition.assetTypeId, selectedFieldKeys: definition.selectedFields.map((field) => field.sourceKey), schemaValid, issues } });
    return Response.json({ data: { schemaValid, issues, assetType: { id: assetType.id, name: assetType.name } } });
  } catch (error) { return errorResponse(error); }
}

function requiredEnv(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
