import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { variableDefinitions } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse, readJson } from "@/lib/input";

const selectedFieldSchema = z.object({ sourceKey: z.string().trim().min(1).max(200), alias: z.string().trim().regex(/^[a-z][a-z0-9_]*$/), expectedKind: z.string().trim().min(1).max(50) });
const definitionSchema = z.object({
  key: z.string().trim().regex(/^org\.[a-z][a-z0-9_]*$/), label: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(),
  assetTypeId: z.string().regex(/^\d+$/), assetTypeName: z.string().trim().min(1).max(200), cardinality: z.enum(["scalar", "list"]),
  selectedFields: z.array(selectedFieldSchema).min(1).max(50).refine((fields) => fields.every((field) => !["Password", "Upload"].includes(field.expectedKind))),
  validationRules: z.object({ exactRecords: z.int().min(0).max(1000).optional(), minItems: z.int().min(0).max(1000).optional(), maxItems: z.int().min(0).max(1000).optional(), requiredFields: z.array(z.string()).max(50).optional(), sortBy: z.string().optional() }),
});

export async function GET() {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  return Response.json({ data: await getDatabase().select().from(variableDefinitions).where(isNull(variableDefinitions.deletedAt)).orderBy(asc(variableDefinitions.key)) });
}

export async function POST(request: Request) {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  try {
    const input = await readJson(request, definitionSchema);
    const [created] = await getDatabase().insert(variableDefinitions).values(input).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "variable_definition.created", entityType: "variable_definition", entityId: created.id, details: { key: created.key, assetTypeId: created.assetTypeId, selectedFieldKeys: created.selectedFields.map((field) => field.sourceKey) } });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id_required" }, { status: 400 });
    const input = await readJson(request, definitionSchema.partial().refine((value) => Object.keys(value).length > 0));
    const [updated] = await getDatabase().update(variableDefinitions).set({ ...input, schemaValid: true, updatedAt: new Date() }).where(and(eq(variableDefinitions.id, id), isNull(variableDefinitions.deletedAt))).returning();
    if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
    await recordAudit({ actorUserId: access.user.id, eventType: "variable_definition.updated", entityType: "variable_definition", entityId: id, details: { fields: Object.keys(input), ...(input.selectedFields ? { selectedFieldKeys: input.selectedFields.map((field) => field.sourceKey) } : {}) } });
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}
