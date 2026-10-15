import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { revisions, templates, templateItems } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import {
  errorResponse,
  richDocumentSchema,
  stepTitleSchema,
} from "@/lib/input";
import {
  lockTemplate,
  bumpTemplate,
  assertPlacement,
} from "@/lib/template-service";
import { restoreOrder } from "@/lib/order-service";
import { validateRepeatVariable } from "@/lib/repeat-validation";
import { OrderError } from "@/lib/template-order";
import { restoreGroup } from "@/lib/conditional-service";
import { assertTemplateStructure } from "@/lib/template-structure";
const order = z.object({
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        position: z.int().min(0),
        anchorItemId: z.uuid().nullable(),
        parentBranchId: z.uuid().nullable().optional(),
        placement: z.enum(["start", "end", "before", "after"]).nullable(),
      }),
    )
    .max(1000),
});
const metadata = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});
const step = z.object({
  templateId: z.uuid(),
  parentBranchId: z.uuid().nullable().default(null),
  title: stepTitleSchema,
  body: richDocumentSchema,
  repeatVariableId: z.uuid().nullable(),
  anchorItemId: z.uuid().nullable(),
  placement: z.enum(["start", "end", "before", "after"]).nullable(),
  position: z.int().min(0),
  deletedAt: z.string().nullable().optional(),
});
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id),
      db = getDatabase(),
      [revision] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.id, id))
        .limit(1);
    if (!revision) throw new OrderError("revision_not_found", 404);
    if (revision.entityType === "template_group")
      await restoreGroup(revision.snapshot, revision.entityId, access.user.id);
    else if (revision.entityType === "template_order")
      await restoreOrder(
        revision.entityId,
        order.parse(revision.snapshot).items,
        access.user.id,
      );
    else
      await db.transaction(async (tx) => {
        if (revision.entityType === "template") {
          const current = await lockTemplate(tx, revision.entityId, true),
            snapshot = metadata.parse(revision.snapshot);
          if (current.scope === "global" && snapshot.deletedAt) {
            const links = await tx
              .select({ id: templates.id })
              .from(templates)
              .where(
                and(
                  eq(templates.globalTemplateId, current.id),
                  isNull(templates.deletedAt),
                ),
              )
              .limit(1);
            if (links.length)
              throw new OrderError("template_has_org_links", 409);
          }
          await recordRevision(
            {
              actorUserId: access.user.id,
              entityType: "template",
              entityId: current.id,
              action: "pre_restore",
              snapshot: current,
            },
            tx,
          );
          // Ownership and parent links are immutable, including during restoration.
          await tx
            .update(templates)
            .set({
              name: snapshot.name,
              description: snapshot.description,
              deletedAt: snapshot.deletedAt
                ? new Date(snapshot.deletedAt)
                : null,
              version: current.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(templates.id, current.id));
        } else if (revision.entityType === "template_item") {
          const snapshot = step.parse(revision.snapshot),
            template = await lockTemplate(tx, snapshot.templateId);
          const [current] = await tx
            .select()
            .from(templateItems)
            .where(eq(templateItems.id, revision.entityId))
            .for("update");
          if (!current || current.templateId !== snapshot.templateId)
            throw new OrderError("step_not_found", 404);
          if (current.nodeType !== "step") throw new OrderError("group_endpoint_required");
          await validateRepeatVariable(snapshot.repeatVariableId, tx);
          if (template.scope === "global")
            await assertPlacement(tx, template, {
              placement: snapshot.placement,
              anchorItemId: snapshot.anchorItemId,
              parentBranchId: snapshot.parentBranchId,
            });
          await recordRevision(
            {
              actorUserId: access.user.id,
              entityType: "template_item",
              entityId: current.id,
              action: "pre_restore",
              snapshot: current,
            },
            tx,
          );
          const siblings = await tx
            .select()
            .from(templateItems)
            .where(
              and(
                eq(templateItems.templateId, current.templateId),
                ne(templateItems.id, current.id),
                isNull(templateItems.deletedAt),
              ),
            );
          const bucket = siblings.filter(
            (item) =>
              item.placement === snapshot.placement &&
              item.parentBranchId === snapshot.parentBranchId &&
              item.anchorItemId === snapshot.anchorItemId,
          );
          const position = bucket.some(
            (item) => item.position === snapshot.position,
          )
            ? Math.max(0, ...bucket.map((item) => item.position)) + 100
            : snapshot.position;
          await tx
            .update(templateItems)
            .set({
              title: snapshot.title,
              body: snapshot.body,
              repeatVariableId: snapshot.repeatVariableId,
              anchorItemId: snapshot.anchorItemId,
              parentBranchId: snapshot.parentBranchId,
              placement: snapshot.placement,
              position,
              deletedAt: snapshot.deletedAt
                ? new Date(snapshot.deletedAt)
                : null,
              version: current.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(templateItems.id, current.id));
          await bumpTemplate(tx, template.id);
          await assertTemplateStructure(tx, template.id, [current.id]);
        } else throw new OrderError("restore_not_supported");
        await recordAudit(
          {
            actorUserId: access.user.id,
            eventType: "revision.restored",
            entityType: revision.entityType,
            entityId: revision.entityId,
            details: { revisionId: id },
          },
          tx,
        );
      });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
