import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabase, type DatabaseTransaction } from "@/db/client";
import { organizations, templateItems, templates } from "@/db/schema";
import { recordAudit, recordRevision } from "./audit";
import { OrderError, validPlacement } from "./template-order";
import { validateRepeatVariable } from "./repeat-validation";
import type { Placement } from "./workspace-types";
import type { RichNode } from "./template-engine";
export async function lockTemplate(
  tx: DatabaseTransaction,
  id: string,
  allowDeleted = false,
) {
  const [initial] = await tx
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  if (!initial || (!allowDeleted && initial.deletedAt))
    throw new OrderError("template_not_found", 404);
  if (initial.globalTemplateId) {
    const [parent] = await tx
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, initial.globalTemplateId),
          eq(templates.scope, "global"),
          isNull(templates.deletedAt),
        ),
      )
      .for("update");
    if (!parent) throw new OrderError("global_template_unavailable", 409);
  }
  const [template] = await tx
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .for("update");
  if (!template || (!allowDeleted && template.deletedAt))
    throw new OrderError("template_not_found", 404);
  if (template.organizationId) {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, template.organizationId),
          eq(organizations.enabled, true),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    if (!org) throw new OrderError("organization_unavailable", 409);
  }
  return template;
}
export async function bumpTemplate(tx: DatabaseTransaction, id: string) {
  await tx
    .update(templates)
    .set({ version: sql`${templates.version}+1`, updatedAt: new Date() })
    .where(eq(templates.id, id));
}
export async function assertPlacement(
  tx: DatabaseTransaction,
  template: typeof templates.$inferSelect,
  entry: { anchorItemId: string | null; placement: Placement | null },
) {
  const inherited = template.globalTemplateId
    ? await tx
        .select({ id: templateItems.id })
        .from(templateItems)
        .where(
          and(
            eq(templateItems.templateId, template.globalTemplateId),
            isNull(templateItems.deletedAt),
          ),
        )
    : [];
  if (
    !validPlacement(
      { itemId: "", position: 0, ...entry },
      new Set(inherited.map((row) => row.id)),
      template.scope,
    )
  )
    throw new OrderError("invalid_anchor", 409);
}
export async function createTemplate(
  input: {
    scope: "global" | "organization";
    name?: string;
    description?: string;
    organizationId?: string;
    globalTemplateId?: string;
  },
  actorUserId: string,
) {
  return getDatabase().transaction(async (tx) => {
    let name = input.name?.trim();
    if (input.scope === "organization") {
      if (!input.organizationId || !input.globalTemplateId)
        throw new OrderError("organization_and_parent_required");
      const parent = await lockTemplate(tx, input.globalTemplateId);
      if (parent.scope !== "global")
        throw new OrderError("parent_must_be_global");
      const [org] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, input.organizationId),
            eq(organizations.enabled, true),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);
      if (!org) throw new OrderError("organization_unavailable", 409);
      name ||= parent.name;
    } else if (input.organizationId || input.globalTemplateId)
      throw new OrderError("global_template_cannot_have_parent");
    if (!name) throw new OrderError("template_name_required");
    const [created] = await tx
      .insert(templates)
      .values({
        scope: input.scope,
        name,
        description: input.description ?? "",
        organizationId: input.organizationId,
        globalTemplateId: input.globalTemplateId,
      })
      .returning();
    await recordAudit(
      {
        actorUserId,
        eventType: "template.created",
        entityType: "template",
        entityId: created.id,
        details: {
          scope: created.scope,
          organizationId: created.organizationId,
          globalTemplateId: created.globalTemplateId,
        },
      },
      tx,
    );
    return created;
  });
}
export async function changeTemplate(
  id: string,
  input: { name?: string; description?: string; expectedVersion: number },
  actorUserId: string,
) {
  return getDatabase().transaction(async (tx) => {
    const current = await lockTemplate(tx, id);
    if (current.version !== input.expectedVersion)
      throw new OrderError("template_changed_reload", 409);
    await recordRevision(
      {
        actorUserId,
        entityType: "template",
        entityId: id,
        action: "update",
        snapshot: current,
      },
      tx,
    );
    const [updated] = await tx
      .update(templates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();
    await recordAudit(
      {
        actorUserId,
        eventType: "template.updated",
        entityType: "template",
        entityId: id,
      },
      tx,
    );
    return updated;
  });
}
export async function deleteTemplate(id: string, actorUserId: string) {
  await getDatabase().transaction(async (tx) => {
    const current = await lockTemplate(tx, id);
    if (current.scope === "global") {
      const links = await tx
        .select({ id: templates.id })
        .from(templates)
        .where(
          and(eq(templates.globalTemplateId, id), isNull(templates.deletedAt)),
        )
        .limit(1);
      if (links.length) throw new OrderError("template_has_org_links", 409);
    }
    await recordRevision(
      {
        actorUserId,
        entityType: "template",
        entityId: id,
        action: "delete",
        snapshot: current,
      },
      tx,
    );
    await tx
      .update(templates)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(eq(templates.id, id));
    await recordAudit(
      {
        actorUserId,
        eventType: "template.deleted",
        entityType: "template",
        entityId: id,
      },
      tx,
    );
  });
}
export async function createStep(
  id: string,
  input: {
    title: string;
    body: RichNode;
    repeatVariableId?: string | null;
    anchorItemId?: string | null;
    placement?: Placement | null;
  },
  actorUserId: string,
) {
  return getDatabase().transaction(async (tx) => {
    const template = await lockTemplate(tx, id);
    await validateRepeatVariable(input.repeatVariableId, tx);
    const placement =
        input.placement ?? (template.scope === "organization" ? "end" : null),
      anchorItemId = input.anchorItemId ?? null;
    await assertPlacement(tx, template, { placement, anchorItemId });
    const rows = await tx
      .select({ position: templateItems.position })
      .from(templateItems)
      .where(
        and(eq(templateItems.templateId, id), isNull(templateItems.deletedAt)),
      );
    const [created] = await tx
      .insert(templateItems)
      .values({
        templateId: id,
        title: input.title,
        body: input.body,
        repeatVariableId: input.repeatVariableId,
        placement,
        anchorItemId,
        position: Math.max(0, ...rows.map((row) => row.position)) + 100,
      })
      .returning();
    await bumpTemplate(tx, id);
    await recordAudit(
      {
        actorUserId,
        eventType: "template.step_added",
        entityType: "template_item",
        entityId: created.id,
        details: { templateId: id },
      },
      tx,
    );
    return created;
  });
}
export async function changeStep(
  id: string,
  itemId: string,
  input: {
    title?: string;
    body?: RichNode;
    repeatVariableId?: string | null;
    expectedVersion: number;
  },
  actorUserId: string,
) {
  return getDatabase().transaction(async (tx) => {
    const template = await lockTemplate(tx, id);
    await validateRepeatVariable(input.repeatVariableId, tx);
    const [current] = await tx
      .select()
      .from(templateItems)
      .where(and(eq(templateItems.id, itemId), isNull(templateItems.deletedAt)))
      .for("update");
    if (!current) throw new OrderError("step_not_found", 404);
    if (current.templateId !== id)
      throw new OrderError("inherited_step_read_only", 403);
    if (current.version !== input.expectedVersion)
      throw new OrderError("step_changed_reload", 409);
    await recordRevision(
      {
        actorUserId,
        entityType: "template_item",
        entityId: itemId,
        action: "update",
        snapshot: current,
      },
      tx,
    );
    const { expectedVersion: _, ...changes } = input;
    void _;
    const [updated] = await tx
      .update(templateItems)
      .set({ ...changes, version: current.version + 1, updatedAt: new Date() })
      .where(eq(templateItems.id, itemId))
      .returning();
    await bumpTemplate(tx, id);
    await recordAudit(
      {
        actorUserId,
        eventType: "template.step_updated",
        entityType: "template_item",
        entityId: itemId,
        details: { templateId: id, fields: Object.keys(changes) },
      },
      tx,
    );
    return { ...updated, templateVersion: template.version + 1 };
  });
}
export async function deleteStep(
  id: string,
  itemId: string,
  actorUserId: string,
) {
  await getDatabase().transaction(async (tx) => {
    await lockTemplate(tx, id);
    const [current] = await tx
      .select()
      .from(templateItems)
      .where(and(eq(templateItems.id, itemId), isNull(templateItems.deletedAt)))
      .for("update");
    if (!current) throw new OrderError("step_not_found", 404);
    if (current.templateId !== id)
      throw new OrderError("inherited_step_read_only", 403);
    await recordRevision(
      {
        actorUserId,
        entityType: "template_item",
        entityId: itemId,
        action: "delete",
        snapshot: current,
      },
      tx,
    );
    await tx
      .update(templateItems)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(eq(templateItems.id, itemId));
    await bumpTemplate(tx, id);
    await recordAudit(
      {
        actorUserId,
        eventType: "template.step_deleted",
        entityType: "template_item",
        entityId: itemId,
        details: { templateId: id },
      },
      tx,
    );
  });
}
