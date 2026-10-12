import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import {
  globalSteps,
  organizationSteps,
  revisions,
  templateItems,
  templates,
} from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { restoreOrder, lockTemplate } from "@/lib/order-service";
import { OrderError } from "@/lib/template-order";
import { validateRepeatVariable } from "@/lib/repeat-validation";
import { errorResponse } from "@/lib/input";
const orderSnapshot = z
  .array(
    z.object({
      itemId: z.uuid(),
      position: z.int().min(0),
      anchorItemId: z.uuid().nullable(),
      placement: z.enum(["before", "after"]).nullable(),
    }),
  )
  .max(1000);
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const db = getDatabase();
    const [revision] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, id))
      .limit(1);
    if (!revision)
      return Response.json({ error: "not_found" }, { status: 404 });
    if (revision.entityType === "template_order") {
      const parsed = orderSnapshot.safeParse(revision.snapshot.items);
      if (!parsed.success)
        return Response.json({ error: "invalid_revision" }, { status: 409 });
      await restoreOrder(revision.entityId, parsed.data, access.user.id);
      return Response.json({ restored: true });
    }
    const repeat =
      revision.snapshot.repeatVariableId ??
      revision.snapshot.snapshotRepeatVariableId;
    await validateRepeatVariable(typeof repeat === "string" ? repeat : null);
    await db.transaction(async (tx) => {
      if (revision.entityType === "template") {
        const [current] = await tx
          .select()
          .from(templates)
          .where(eq(templates.id, revision.entityId))
          .for("update");
        if (!current) throw new OrderError("entity_not_found", 404);
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
        const snapshot = revision.snapshot as typeof current;
        await tx
          .update(templates)
          .set({
            name: snapshot.name,
            description: snapshot.description,
            deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(templates.id, current.id));
      } else if (revision.entityType === "global_step") {
        const [current] = await tx
          .select()
          .from(globalSteps)
          .where(eq(globalSteps.id, revision.entityId))
          .for("update");
        if (!current) throw new OrderError("entity_not_found", 404);
        await recordRevision(
          {
            actorUserId: access.user.id,
            entityType: "global_step",
            entityId: current.id,
            action: "pre_restore",
            snapshot: current,
          },
          tx,
        );
        const snapshot = revision.snapshot as typeof current;
        await tx
          .update(globalSteps)
          .set({
            title: snapshot.title,
            body: snapshot.body,
            repeatVariableId: snapshot.repeatVariableId,
            deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(globalSteps.id, current.id));
      } else if (revision.entityType === "template_item") {
        const [identity] = await tx
          .select({ templateId: templateItems.templateId })
          .from(templateItems)
          .where(eq(templateItems.id, revision.entityId));
        if (!identity) throw new OrderError("entity_not_found", 404);
        await lockTemplate(tx, identity.templateId);
        const [current] = await tx
          .select()
          .from(templateItems)
          .where(eq(templateItems.id, revision.entityId))
          .for("update");
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
        const snapshot = revision.snapshot as typeof current;
        let position = snapshot.position;
        if (
          current.kind === "global" &&
          current.deletedAt &&
          !snapshot.deletedAt
        ) {
          const [source] = await tx
            .select({ id: globalSteps.id })
            .from(globalSteps)
            .where(
              and(
                eq(globalSteps.id, current.globalStepId!),
                isNull(globalSteps.deletedAt),
              ),
            );
          if (!source) throw new OrderError("global_step_not_found", 409);
          const siblings = await tx
            .select({ position: templateItems.position })
            .from(templateItems)
            .where(
              and(
                eq(templateItems.templateId, current.templateId),
                eq(templateItems.kind, "global"),
                isNull(templateItems.deletedAt),
              ),
            );
          if (siblings.some((s) => s.position === position))
            position = Math.max(0, ...siblings.map((s) => s.position)) + 100;
        }
        await tx
          .update(templateItems)
          .set({
            snapshotTitle: snapshot.snapshotTitle,
            snapshotBody: snapshot.snapshotBody,
            snapshotRepeatVariableId: snapshot.snapshotRepeatVariableId,
            anchorItemId: snapshot.anchorItemId,
            placement: snapshot.placement,
            position,
            deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(templateItems.id, current.id));
      } else if (revision.entityType === "organization_step") {
        const [current] = await tx
          .select()
          .from(organizationSteps)
          .where(eq(organizationSteps.id, revision.entityId))
          .for("update");
        if (!current) throw new OrderError("entity_not_found", 404);
        await recordRevision(
          {
            actorUserId: access.user.id,
            entityType: "organization_step",
            entityId: current.id,
            action: "pre_restore",
            snapshot: current,
          },
          tx,
        );
        const snapshot = revision.snapshot as typeof current;
        await tx
          .update(organizationSteps)
          .set({
            title: snapshot.title,
            body: snapshot.body,
            repeatVariableId: snapshot.repeatVariableId,
            deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(organizationSteps.id, current.id));
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
    return Response.json({ restored: true });
  } catch (error) {
    if (error instanceof OrderError)
      return Response.json({ error: error.message }, { status: error.status });
    return errorResponse(error);
  }
}
