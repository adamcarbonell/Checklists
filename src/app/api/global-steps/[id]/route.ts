import { and, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { globalSteps, templateItems } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { errorResponse, readJson, stepUpdateSchema } from "@/lib/input";

export async function PATCH(request: Request, context: RouteContext<"/api/global-steps/[id]">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const input = await readJson(request, stepUpdateSchema);
    const db = getDatabase();
    const [existing] = await db.select().from(globalSteps).where(and(eq(globalSteps.id, id), isNull(globalSteps.deletedAt))).limit(1);
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "global_step", entityId: id, action: "update", snapshot: existing });
    const [updated] = await db.update(globalSteps).set({ ...input, updatedAt: new Date() }).where(eq(globalSteps.id, id)).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "global_step.updated", entityType: "global_step", entityId: id, details: { fields: Object.keys(input) } });
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/global-steps/[id]">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  const { id } = await context.params;
  const db = getDatabase();
  const references = await db.select({ id: templateItems.id }).from(templateItems).where(and(eq(templateItems.globalStepId, id), isNull(templateItems.deletedAt))).limit(1);
  if (references.length) return Response.json({ error: "step_is_referenced" }, { status: 409 });
  const [existing] = await db.select().from(globalSteps).where(and(eq(globalSteps.id, id), isNull(globalSteps.deletedAt))).limit(1);
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
  await recordRevision({ actorUserId: access.user.id, entityType: "global_step", entityId: id, action: "delete", snapshot: existing });
  await db.update(globalSteps).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(globalSteps.id, id));
  await recordAudit({ actorUserId: access.user.id, eventType: "global_step.deleted", entityType: "global_step", entityId: id });
  return new Response(null, { status: 204 });
}
