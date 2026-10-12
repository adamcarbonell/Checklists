import { and, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { templates } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { errorResponse, readJson, templateUpdateSchema } from "@/lib/input";
import { lockTemplate } from "@/lib/order-service";
import { OrderError } from "@/lib/template-order";
const failure = (error: unknown) =>
  error instanceof OrderError
    ? Response.json({ error: error.message }, { status: error.status })
    : errorResponse(error);
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const [row] = await getDatabase()
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
    .limit(1);
  return row
    ? Response.json({ data: row })
    : Response.json({ error: "not_found" }, { status: 404 });
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const input = await readJson(request, templateUpdateSchema);
    const updated = await getDatabase().transaction(async (tx) => {
      await lockTemplate(tx, id);
      const [existing] = await tx
        .select()
        .from(templates)
        .where(eq(templates.id, id));
      await recordRevision(
        {
          actorUserId: access.user.id,
          entityType: "template",
          entityId: id,
          action: "update",
          snapshot: existing,
        },
        tx,
      );
      const [row] = await tx
        .update(templates)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(templates.id, id))
        .returning();
      await recordAudit(
        {
          actorUserId: access.user.id,
          eventType: "template.updated",
          entityType: "template",
          entityId: id,
          details: { fields: Object.keys(input) },
        },
        tx,
      );
      return row;
    });
    return Response.json({ data: updated });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    await getDatabase().transaction(async (tx) => {
      await lockTemplate(tx, id);
      const [existing] = await tx
        .select()
        .from(templates)
        .where(eq(templates.id, id));
      await recordRevision(
        {
          actorUserId: access.user.id,
          entityType: "template",
          entityId: id,
          action: "delete",
          snapshot: existing,
        },
        tx,
      );
      await tx
        .update(templates)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(templates.id, id));
      await recordAudit(
        {
          actorUserId: access.user.id,
          eventType: "template.deleted",
          entityType: "template",
          entityId: id,
        },
        tx,
      );
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}
