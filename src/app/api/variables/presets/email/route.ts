import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { variableDefinitions } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { discoverEmailVariable, EMAIL_VARIABLE_KEY, EmailVariableError } from "@/lib/email-variable";
import { errorResponse } from "@/lib/input";
import { ItGlueClient, ItGlueHttpError, ItGlueLimitError, ItGlueMalformedError } from "@/lib/itglue";

export async function POST() {
  const access = await requireRole("admin");
  if (!access.ok) return access.response;
  try {
    const db = getDatabase();
    const [existing] = await db.select({ id: variableDefinitions.id }).from(variableDefinitions)
      .where(eq(variableDefinitions.key, EMAIL_VARIABLE_KEY)).limit(1);
    if (existing) return Response.json({ error: "email_variable_exists" }, { status: 409 });
    const apiKey = process.env.ITGLUE_API_KEY;
    if (!apiKey) return Response.json({ error: "itglue_not_configured" }, { status: 503 });
    const client = new ItGlueClient({
      apiKey,
      baseUrl: process.env.ITGLUE_BASE_URL,
      onRequestPreview: async (preview) => recordAudit({
        actorUserId: access.user.id, eventType: "itglue.request.preview",
        entityType: "variable_definition", details: preview,
      }),
    });
    const input = await discoverEmailVariable(client);
    const created = await db.transaction(async (tx) => {
      const [definition] = await tx.insert(variableDefinitions).values({ ...input, schemaValid: true })
        .onConflictDoNothing({ target: variableDefinitions.key }).returning();
      if (!definition) return null;
      await recordAudit({
        actorUserId: access.user.id, eventType: "variable_definition.created",
        entityType: "variable_definition", entityId: definition.id,
        details: { key: definition.key, assetTypeId: definition.assetTypeId, selectedFieldKeys: definition.selectedFields.map((field) => field.sourceKey), preset: "email", schemaValid: true },
      }, tx);
      return definition;
    });
    if (!created) return Response.json({ error: "email_variable_exists" }, { status: 409 });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailVariableError)
      return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof ItGlueHttpError || error instanceof ItGlueLimitError || error instanceof ItGlueMalformedError)
      return Response.json({ error: "email_schema_lookup_failed" }, { status: 502 });
    return errorResponse(error);
  }
}
