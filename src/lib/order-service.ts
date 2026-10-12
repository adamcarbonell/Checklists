import { and, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { templateItems } from "@/db/schema";
import { recordAudit, recordRevision } from "./audit";
import { loadWorkspace } from "./workspace-data";
import { lockTemplate, bumpTemplate } from "./template-service";
import {
  OrderError,
  orderEntry,
  stepOrder,
  validateOrder,
  validPlacement,
  type OrderEntry,
} from "./template-order";
export { lockTemplate } from "./template-service";
export async function saveOrder(
  id: string,
  input: {
    movedItemId: string;
    expectedVersion: number;
    expectedParentVersion: number | null;
    expectedOrder: OrderEntry[];
    proposedOrder: OrderEntry[];
  },
  actorUserId: string,
) {
  await getDatabase().transaction(async (tx) => {
    const template = await lockTemplate(tx, id),
      workspace = await loadWorkspace(id, tx);
    if (!workspace) throw new OrderError("template_not_found", 404);
    if (
      template.version !== input.expectedVersion ||
      (workspace.parent?.version ?? null) !== input.expectedParentVersion
    )
      throw new OrderError("order_changed_reload", 409);
    validateOrder(
      workspace.steps.map(stepOrder),
      input.expectedOrder,
      input.proposedOrder,
      input.movedItemId,
      template.scope,
    );
    await recordRevision(
      {
        actorUserId,
        entityType: "template_order",
        entityId: id,
        action: "reorder",
        snapshot: {
          items: workspace.steps
            .filter((step) => !step.inherited)
            .map(stepOrder)
            .map(orderEntry),
        },
      },
      tx,
    );
    for (const entry of input.proposedOrder.filter((row) =>
      workspace.steps.some((step) => step.id === row.itemId && !step.inherited),
    )) {
      const current = workspace.steps.find((step) => step.id === entry.itemId)!;
      await tx
        .update(templateItems)
        .set({
          position: entry.position,
          anchorItemId: entry.anchorItemId,
          placement: entry.placement,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(templateItems.id, entry.itemId));
    }
    await bumpTemplate(tx, id);
    await recordAudit(
      {
        actorUserId,
        eventType: "template.order_changed",
        entityType: "template",
        entityId: id,
        details: { movedItemId: input.movedItemId },
      },
      tx,
    );
  });
}
export async function restoreOrder(
  id: string,
  items: OrderEntry[],
  actorUserId: string,
) {
  await getDatabase().transaction(async (tx) => {
    const template = await lockTemplate(tx, id),
      workspace = await loadWorkspace(id, tx);
    if (!workspace) throw new OrderError("template_not_found", 404);
    const current = workspace.steps.filter((step) => !step.inherited);
    if (
      new Set(items.map((row) => row.itemId)).size !== items.length ||
      JSON.stringify(items.map((row) => row.itemId).sort()) !==
        JSON.stringify(current.map((row) => row.id).sort())
    )
      throw new OrderError("order_membership_changed", 409);
    const anchors = new Set(
      workspace.steps.filter((step) => step.inherited).map((step) => step.id),
    );
    for (const entry of items)
      if (!validPlacement(entry, anchors, template.scope))
        throw new OrderError("invalid_restored_anchor", 409);
    const buckets = new Map<string, Set<number>>();
    for (const entry of items) {
      const key = entry.placement + ":" + entry.anchorItemId,
        positions = buckets.get(key) ?? new Set<number>();
      if (positions.has(entry.position))
        throw new OrderError("duplicate_position", 409);
      positions.add(entry.position);
      buckets.set(key, positions);
    }
    await recordRevision(
      {
        actorUserId,
        entityType: "template_order",
        entityId: id,
        action: "pre_restore",
        snapshot: { items: current.map(stepOrder).map(orderEntry) },
      },
      tx,
    );
    for (const entry of items) {
      const row = current.find((step) => step.id === entry.itemId)!;
      await tx
        .update(templateItems)
        .set({
          position: entry.position,
          anchorItemId: entry.anchorItemId,
          placement: entry.placement,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(templateItems.id, entry.itemId),
            isNull(templateItems.deletedAt),
          ),
        );
    }
    await bumpTemplate(tx, id);
    await recordAudit(
      {
        actorUserId,
        eventType: "template.order_restored",
        entityType: "template",
        entityId: id,
      },
      tx,
    );
  });
}
