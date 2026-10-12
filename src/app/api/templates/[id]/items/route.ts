import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import {
  globalSteps,
  organizationSteps,
  templateItems,
  templates,
} from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { errorResponse, readJson, richDocumentSchema } from "@/lib/input";
import { validateRepeatVariable } from "@/lib/repeat-validation";
import { lockTemplate } from "@/lib/order-service";
import { OrderError } from "@/lib/template-order";
const itemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("global"),
    globalStepId: z.uuid(),
    position: z.int().min(0),
  }),
  z.object({
    kind: z.literal("organization"),
    organizationId: z.uuid(),
    sourceOrganizationStepId: z.uuid(),
    anchorItemId: z.uuid(),
    placement: z.enum(["before", "after"]),
    position: z.int().min(0),
  }),
]);
const snapshotSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: richDocumentSchema.optional(),
    repeatVariableId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
function failure(error: unknown) {
  return error instanceof OrderError
    ? Response.json({ error: error.message }, { status: error.status })
    : errorResponse(error);
}
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  const { id } = await context.params;
  return Response.json({
    data: await getDatabase()
      .select()
      .from(templateItems)
      .where(
        and(eq(templateItems.templateId, id), isNull(templateItems.deletedAt)),
      )
      .orderBy(asc(templateItems.position)),
  });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const input = await readJson(request, itemSchema);
    const created = await getDatabase().transaction(async (tx) => {
      await lockTemplate(tx, id);
      let values: typeof templateItems.$inferInsert;
      const current = await tx
        .select()
        .from(templateItems)
        .where(
          and(
            eq(templateItems.templateId, id),
            isNull(templateItems.deletedAt),
          ),
        );
      if (input.kind === "global") {
        const [source] = await tx
          .select()
          .from(globalSteps)
          .where(
            and(
              eq(globalSteps.id, input.globalStepId),
              isNull(globalSteps.deletedAt),
            ),
          )
          .limit(1);
        if (!source) throw new OrderError("global_step_not_found", 404);
        values = {
          templateId: id,
          kind: "global",
          globalStepId: source.id,
          position: Math.max(
            input.position,
            ...current
              .filter((r) => r.kind === "global")
              .map((r) => r.position + 100),
            100,
          ),
        };
      } else {
        const [source] = await tx
          .select()
          .from(organizationSteps)
          .where(
            and(
              eq(organizationSteps.id, input.sourceOrganizationStepId),
              eq(organizationSteps.organizationId, input.organizationId),
              isNull(organizationSteps.deletedAt),
            ),
          )
          .limit(1);
        if (!source) throw new OrderError("organization_step_not_found", 404);
        if (
          !current.some(
            (r) => r.id === input.anchorItemId && r.kind === "global",
          )
        )
          throw new OrderError("anchor_not_found", 409);
        values = {
          templateId: id,
          kind: "organization",
          organizationId: input.organizationId,
          sourceOrganizationStepId: source.id,
          snapshotTitle: source.title,
          snapshotBody: source.body,
          snapshotRepeatVariableId: source.repeatVariableId,
          anchorItemId: input.anchorItemId,
          placement: input.placement,
          position: Math.max(
            input.position,
            ...current
              .filter(
                (r) =>
                  r.organizationId === input.organizationId &&
                  r.anchorItemId === input.anchorItemId &&
                  r.placement === input.placement,
              )
              .map((r) => r.position + 100),
            100,
          ),
        };
      }
      const [row] = await tx.insert(templateItems).values(values).returning();
      await tx
        .update(templates)
        .set({ updatedAt: new Date() })
        .where(eq(templates.id, id));
      await recordAudit(
        {
          actorUserId: access.user.id,
          eventType:
            input.kind === "global"
              ? "template.global_reference_added"
              : "template.organization_snapshot_added",
          entityType: "template",
          entityId: id,
          details: { itemId: row.id },
        },
        tx,
      );
      return row;
    });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const itemId = new URL(request.url).searchParams.get("itemId");
    if (!itemId)
      return Response.json({ error: "item_id_required" }, { status: 400 });
    const input = await readJson(request, snapshotSchema);
    await validateRepeatVariable(input.repeatVariableId);
    const updated = await getDatabase().transaction(async (tx) => {
      await lockTemplate(tx, id);
      const [existing] = await tx
        .select()
        .from(templateItems)
        .where(
          and(
            eq(templateItems.id, itemId),
            eq(templateItems.templateId, id),
            eq(templateItems.kind, "organization"),
            isNull(templateItems.deletedAt),
          ),
        )
        .for("update");
      if (!existing)
        throw new OrderError("organization_snapshot_not_found", 404);
      await recordRevision(
        {
          actorUserId: access.user.id,
          entityType: "template_item",
          entityId: itemId,
          action: "update",
          snapshot: existing,
        },
        tx,
      );
      const [row] = await tx
        .update(templateItems)
        .set({
          ...(input.title !== undefined ? { snapshotTitle: input.title } : {}),
          ...(input.body !== undefined ? { snapshotBody: input.body } : {}),
          ...(input.repeatVariableId !== undefined
            ? { snapshotRepeatVariableId: input.repeatVariableId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(templateItems.id, itemId))
        .returning();
      await recordAudit(
        {
          actorUserId: access.user.id,
          eventType: "template.organization_snapshot_updated",
          entityType: "template",
          entityId: id,
          details: { itemId, fields: Object.keys(input) },
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
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const itemId = new URL(request.url).searchParams.get("itemId");
    if (!itemId)
      return Response.json({ error: "item_id_required" }, { status: 400 });
    await getDatabase().transaction(async (tx) => {
      await lockTemplate(tx, id);
      const [existing] = await tx
        .select()
        .from(templateItems)
        .where(
          and(
            eq(templateItems.id, itemId),
            eq(templateItems.templateId, id),
            isNull(templateItems.deletedAt),
          ),
        )
        .for("update");
      if (!existing) throw new OrderError("not_found", 404);
      await recordRevision(
        {
          actorUserId: access.user.id,
          entityType: "template_item",
          entityId: itemId,
          action: "delete",
          snapshot: existing,
        },
        tx,
      );
      await tx
        .update(templateItems)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(templateItems.id, itemId));
      await tx
        .update(templates)
        .set({ updatedAt: new Date() })
        .where(eq(templates.id, id));
      await recordAudit(
        {
          actorUserId: access.user.id,
          eventType: "template.item_deleted",
          entityType: "template",
          entityId: id,
          details: { itemId },
        },
        tx,
      );
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}
