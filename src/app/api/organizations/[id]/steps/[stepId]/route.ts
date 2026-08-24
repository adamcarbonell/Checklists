import { and, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { organizationSteps } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { errorResponse, readJson, stepUpdateSchema } from "@/lib/input";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; stepId: string }> }) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const { id, stepId } = await context.params;
    const input = await readJson(request, stepUpdateSchema);
    const db = getDatabase();
    const [existing] = await db.select().from(organizationSteps).where(and(eq(organizationSteps.id, stepId), eq(organizationSteps.organizationId, id), isNull(organizationSteps.deletedAt))).limit(1);
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "organization_step", entityId: stepId, action: "update", snapshot: existing });
    const [updated] = await db.update(organizationSteps).set({ ...input, updatedAt: new Date() }).where(eq(organizationSteps.id, stepId)).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "organization_step.updated", entityType: "organization_step", entityId: stepId, details: { organizationId: id, fields: Object.keys(input) } });
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; stepId: string }> }) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  const { id, stepId } = await context.params;
  const db = getDatabase();
  const [existing] = await db.select().from(organizationSteps).where(and(eq(organizationSteps.id, stepId), eq(organizationSteps.organizationId, id), isNull(organizationSteps.deletedAt))).limit(1);
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
  await recordRevision({ actorUserId: access.user.id, entityType: "organization_step", entityId: stepId, action: "delete", snapshot: existing });
  await db.update(organizationSteps).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(organizationSteps.id, stepId));
  await recordAudit({ actorUserId: access.user.id, eventType: "organization_step.deleted", entityType: "organization_step", entityId: stepId, details: { organizationId: id } });
  return new Response(null, { status: 204 });
}
