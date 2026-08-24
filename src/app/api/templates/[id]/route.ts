import { and, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { templates } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { errorResponse, readJson, templateUpdateSchema } from "@/lib/input";

export async function GET(_request: Request, context: RouteContext<"/api/templates/[id]">) {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  const { id } = await context.params;
  const [row] = await getDatabase().select().from(templates).where(and(eq(templates.id, id), isNull(templates.deletedAt))).limit(1);
  return row ? Response.json({ data: row }) : Response.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(request: Request, context: RouteContext<"/api/templates/[id]">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const input = await readJson(request, templateUpdateSchema);
    const db = getDatabase();
    const [existing] = await db.select().from(templates).where(and(eq(templates.id, id), isNull(templates.deletedAt))).limit(1);
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "template", entityId: id, action: "update", snapshot: existing });
    const [updated] = await db.update(templates).set({ ...input, updatedAt: new Date() }).where(eq(templates.id, id)).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "template.updated", entityType: "template", entityId: id, details: { fields: Object.keys(input) } });
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/templates/[id]">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  const { id } = await context.params;
  const db = getDatabase();
  const [existing] = await db.select().from(templates).where(and(eq(templates.id, id), isNull(templates.deletedAt))).limit(1);
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
  await recordRevision({ actorUserId: access.user.id, entityType: "template", entityId: id, action: "delete", snapshot: existing });
  await db.update(templates).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(templates.id, id));
  await recordAudit({ actorUserId: access.user.id, eventType: "template.deleted", entityType: "template", entityId: id });
  return new Response(null, { status: 204 });
}
