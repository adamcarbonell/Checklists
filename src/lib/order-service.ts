import { and, eq, isNull } from "drizzle-orm";
import { getDatabase, type DatabaseTransaction } from "@/db/client";
import { templateItems, templates } from "@/db/schema";
import { recordAudit, recordRevision } from "./audit";
import {
  OrderError,
  orderEntry,
  validateOrder,
  type OrderEntry,
  type OrderItem,
} from "./template-order";

export async function lockTemplate(tx: DatabaseTransaction, id: string) {
  const [template] = await tx
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
    .for("update");
  if (!template) throw new OrderError("template_not_found", 404);
}
export function toOrder(
  rows: (typeof templateItems.$inferSelect)[],
): OrderItem[] {
  return rows.map((r) => ({
    itemId: r.id,
    kind: r.kind,
    organizationId: r.organizationId,
    position: r.position,
    anchorItemId: r.anchorItemId,
    placement: r.placement,
  }));
}
export async function saveOrder(
  id: string,
  input: {
    organizationId: string | null;
    movedItemId: string;
    expectedOrder: OrderEntry[];
    proposedOrder: OrderEntry[];
  },
  actorUserId: string,
) {
  return getDatabase().transaction(async (tx) => {
    await lockTemplate(tx, id);
    const rows = await tx
      .select()
      .from(templateItems)
      .where(
        and(eq(templateItems.templateId, id), isNull(templateItems.deletedAt)),
      )
      .for("update");
    const all = toOrder(rows);
    const scoped = all.filter(
      (r) => r.kind === "global" || r.organizationId === input.organizationId,
    );
    validateOrder(
      scoped,
      input.expectedOrder,
      input.proposedOrder,
      input.movedItemId,
      input.organizationId,
    );
    await recordRevision(
      {
        actorUserId,
        entityType: "template_order",
        entityId: id,
        action: "reorder",
        snapshot: { items: all.map(orderEntry) },
      },
      tx,
    );
    for (const entry of input.proposedOrder)
      await tx
        .update(templateItems)
        .set({
          position: entry.position,
          anchorItemId: entry.anchorItemId,
          placement: entry.placement,
          updatedAt: new Date(),
        })
        .where(eq(templateItems.id, entry.itemId));
    await tx
      .update(templates)
      .set({ updatedAt: new Date() })
      .where(eq(templates.id, id));
    await recordAudit(
      {
        actorUserId,
        eventType: "template.order_changed",
        entityType: "template",
        entityId: id,
        details: {
          movedItemId: input.movedItemId,
          organizationId: input.organizationId,
        },
      },
      tx,
    );
    return input.proposedOrder;
  });
}
export async function restoreOrder(
  id: string,
  items: OrderEntry[],
  actorUserId: string,
) {
  await getDatabase().transaction(async (tx) => {
    await lockTemplate(tx, id);
    const rows = await tx
      .select()
      .from(templateItems)
      .where(
        and(eq(templateItems.templateId, id), isNull(templateItems.deletedAt)),
      )
      .for("update");
    if (
      new Set(items.map((i) => i.itemId)).size !== items.length ||
      JSON.stringify(rows.map((r) => r.id).sort()) !==
        JSON.stringify(items.map((i) => i.itemId).sort())
    )
      throw new OrderError("order_membership_changed", 409);
    const globals = new Set(
      rows.filter((r) => r.kind === "global").map((r) => r.id),
    );
    for (const item of items) {
      const row = rows.find((r) => r.id === item.itemId)!;
      if (
        row.kind === "global"
          ? !!item.anchorItemId || !!item.placement
          : !item.anchorItemId ||
            !globals.has(item.anchorItemId) ||
            !item.placement
      )
        throw new OrderError("invalid_restored_anchor", 409);
    }
    await recordRevision(
      {
        actorUserId,
        entityType: "template_order",
        entityId: id,
        action: "pre_restore",
        snapshot: { items: toOrder(rows).map(orderEntry) },
      },
      tx,
    );
    for (const item of items)
      await tx
        .update(templateItems)
        .set({
          position: item.position,
          anchorItemId: item.anchorItemId,
          placement: item.placement,
          updatedAt: new Date(),
        })
        .where(eq(templateItems.id, item.itemId));
    await tx
      .update(templates)
      .set({ updatedAt: new Date() })
      .where(eq(templates.id, id));
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
