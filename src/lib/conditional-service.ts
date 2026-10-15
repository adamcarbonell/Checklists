import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type DatabaseTransaction } from "@/db/client";
import { templateItems, templateBranches, templates } from "@/db/schema";
import { recordAudit, recordRevision } from "./audit";
import { lockTemplate, bumpTemplate, assertPlacement } from "./template-service";
import { assertTemplateStructure } from "./template-structure";
import { loadDefinitions } from "./workspace-data";
import { conditionFields, type Comparison } from "./conditional-types";
import { validComparison } from "./conditional-tree";
import { OrderError } from "./template-order";
import { comparisonSchema } from "./conditional-input";
import { stepTitleSchema, richDocumentSchema } from "./input";
import type { Placement } from "./workspace-types";
import { validateRepeatVariable } from "./repeat-validation";

type Tx = DatabaseTransaction;
type Node = typeof templateItems.$inferSelect;
async function approvedCondition(tx: Tx, condition: Comparison | null) {
  if (condition !== null && !validComparison(condition, conditionFields(await loadDefinitions(tx))))
    throw new OrderError("invalid_condition_field_or_value");
}
async function ownedGroup(tx: Tx, templateId: string, groupId: string, expectedVersion?: number) {
  const template = await lockTemplate(tx, templateId);
  const [group] = await tx.select().from(templateItems).where(and(eq(templateItems.id, groupId), isNull(templateItems.deletedAt))).for("update");
  if (!group || group.nodeType !== "condition_group") throw new OrderError("group_not_found", 404);
  if (group.templateId !== templateId) throw new OrderError("inherited_step_read_only", 403);
  if (expectedVersion !== undefined && group.version !== expectedVersion) throw new OrderError("group_changed_reload", 409);
  return { template, group };
}
export async function ownedForest(tx: Tx, templateId: string, roots: string[], initialBranches: string[] = []) {
  const nodes = await tx.select().from(templateItems).where(and(eq(templateItems.templateId, templateId), isNull(templateItems.deletedAt)));
  const branches = nodes.length ? await tx.select().from(templateBranches).where(and(inArray(templateBranches.groupItemId, nodes.map((row) => row.id)), isNull(templateBranches.deletedAt))) : [];
  const nodeIds = new Set(roots), branchIds = new Set(initialBranches);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of branches) if (nodeIds.has(row.groupItemId) && !branchIds.has(row.id)) { branchIds.add(row.id); changed = true; }
    for (const row of nodes) if (row.parentBranchId && branchIds.has(row.parentBranchId) && !nodeIds.has(row.id)) { nodeIds.add(row.id); changed = true; }
  }
  return { nodes: nodes.filter((row) => nodeIds.has(row.id)), branches: branches.filter((row) => branchIds.has(row.id)) };
}
async function snapshotGroup(tx: Tx, group: Node, actorUserId: string, action: string) {
  const forest = await ownedForest(tx, group.templateId, [group.id]);
  if (!forest.nodes.some((row) => row.id === group.id)) forest.nodes.push(group);
  await recordRevision({ actorUserId, entityType: "template_group", entityId: group.id, action,
    snapshot: { templateId: group.templateId, rootId: group.id, ...forest } }, tx);
}
async function finish(tx: Tx, group: Node, actorUserId: string, action: string) {
  await assertTemplateStructure(tx, group.templateId, [group.id]);
  const [updated] = await tx.update(templateItems).set({ version: group.version + 1, updatedAt: new Date() }).where(eq(templateItems.id, group.id)).returning();
  await bumpTemplate(tx, group.templateId);
  await recordAudit({ actorUserId, eventType: action, entityType: "template_group", entityId: group.id, details: { templateId: group.templateId } }, tx);
  const [template] = await tx.select({ version: templates.version }).from(templates).where(eq(templates.id, group.templateId));
  return { ...updated, templateVersion: template.version };
}
export async function createGroup(templateId: string, input: {
  title: string; condition: Comparison; parentBranchId?: string | null; anchorItemId?: string | null; placement?: Placement | null;
}, actorUserId: string) {
  return getDatabase().transaction(async (tx) => {
    const template = await lockTemplate(tx, templateId);
    await approvedCondition(tx, input.condition);
    const placement = input.placement ?? (template.scope === "organization" ? "end" : null);
    await assertPlacement(tx, template, { placement, anchorItemId: input.anchorItemId ?? null, parentBranchId: input.parentBranchId });
    const rows = await tx.select({ position: templateItems.position }).from(templateItems).where(eq(templateItems.templateId, templateId));
    const [group] = await tx.insert(templateItems).values({ templateId, title: input.title, body: { type: "doc", content: [] }, nodeType: "condition_group",
      parentBranchId: input.parentBranchId ?? null, placement, anchorItemId: input.anchorItemId ?? null, position: Math.max(0, ...rows.map((row) => row.position)) + 100 }).returning();
    const [branch] = await tx.insert(templateBranches).values({ groupItemId: group.id, position: 100, condition: input.condition }).returning();
    await assertTemplateStructure(tx, templateId, [group.id]);
    await bumpTemplate(tx, templateId);
    await recordAudit({ actorUserId, eventType: "template.group_added", entityType: "template_group", entityId: group.id, details: { templateId } }, tx);
    return { ...group, branches: [branch] };
  });
}
export async function changeGroup(templateId: string, groupId: string, input: { title?: string; branchOrder?: string[]; expectedVersion: number }, actorUserId: string) {
  return getDatabase().transaction(async (tx) => {
    const { group } = await ownedGroup(tx, templateId, groupId, input.expectedVersion);
    await snapshotGroup(tx, group, actorUserId, "update");
    if (input.title !== undefined) await tx.update(templateItems).set({ title: input.title }).where(eq(templateItems.id, groupId));
    if (input.branchOrder) {
      const rows = await tx.select().from(templateBranches).where(and(eq(templateBranches.groupItemId, groupId), isNull(templateBranches.deletedAt)));
      if (new Set(input.branchOrder).size !== rows.length || input.branchOrder.length !== rows.length || rows.some((row) => !input.branchOrder!.includes(row.id))) throw new OrderError("invalid_branch_membership");
      for (const [index, id] of input.branchOrder.entries()) await tx.update(templateBranches).set({ position: (index + 1) * 100, updatedAt: new Date() }).where(eq(templateBranches.id, id));
    }
    return finish(tx, group, actorUserId, "template.group_updated");
  });
}
export async function writeBranch(templateId: string, groupId: string, branchId: string | null, input: { condition: Comparison | null; expectedVersion: number }, actorUserId: string) {
  return getDatabase().transaction(async (tx) => {
    const { group } = await ownedGroup(tx, templateId, groupId, input.expectedVersion);
    await approvedCondition(tx, input.condition);
    const rows = await tx.select().from(templateBranches).where(and(eq(templateBranches.groupItemId, groupId), isNull(templateBranches.deletedAt))).orderBy(templateBranches.position);
    if (branchId && !rows.some((row) => row.id === branchId)) throw new OrderError("branch_not_found", 404);
    if (input.condition === null && rows.some((row) => row.condition === null && row.id !== branchId)) throw new OrderError("else_already_exists");
    await snapshotGroup(tx, group, actorUserId, branchId ? "branch_updated" : "branch_added");
    let id = branchId;
    if (branchId) await tx.update(templateBranches).set({ condition: input.condition, updatedAt: new Date() }).where(eq(templateBranches.id, branchId));
    else {
      const [created] = await tx.insert(templateBranches).values({ groupItemId: groupId, condition: input.condition, position: Math.max(0, ...rows.map((row) => row.position)) + 100 }).returning();
      id = created.id;
      const order = rows.map((row) => row.id);
      const otherwise = rows.findIndex((row) => row.condition === null);
      order.splice(input.condition !== null && otherwise >= 0 ? otherwise : order.length, 0, id);
      for (const [index, branch] of order.entries()) await tx.update(templateBranches).set({ position: (index + 1) * 100 }).where(eq(templateBranches.id, branch));
    }
    const updated = await finish(tx, group, actorUserId, "template.branch_updated");
    return { id: id!, groupVersion: updated.version, templateVersion: updated.templateVersion };
  });
}
export async function deleteConditional(templateId: string, groupId: string, branchId: string | null, expectedVersion: number, actorUserId: string) {
  return getDatabase().transaction(async (tx) => {
    const { group } = await ownedGroup(tx, templateId, groupId, expectedVersion);
    const rows = await tx.select().from(templateBranches).where(and(eq(templateBranches.groupItemId, groupId), isNull(templateBranches.deletedAt)));
    if (branchId && !rows.some((row) => row.id === branchId)) throw new OrderError("branch_not_found", 404);
    if (branchId && rows.filter((row) => row.id !== branchId && row.condition !== null).length === 0) throw new OrderError("if_branch_required");
    await snapshotGroup(tx, group, actorUserId, branchId ? "branch_deleted" : "delete");
    const forest = await ownedForest(tx, templateId, branchId ? [] : [groupId], branchId ? [branchId] : []);
    if (forest.nodes.length) await tx.update(templateItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(templateItems.id, forest.nodes.map((row) => row.id)));
    const branchIds = [...new Set([...forest.branches.map((row) => row.id), ...(branchId ? [branchId] : [])])];
    if (branchIds.length) await tx.update(templateBranches).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(templateBranches.id, branchIds));
    if (branchId) return finish(tx, group, actorUserId, "template.branch_deleted");
    await tx.update(templateItems).set({ version: group.version + 1 }).where(eq(templateItems.id, groupId));
    await bumpTemplate(tx, templateId);
    await recordAudit({ actorUserId, eventType: "template.group_deleted", entityType: "template_group", entityId: groupId, details: { templateId } }, tx);
    return null;
  });
}

const nodeSnapshot = z.object({ id: z.uuid(), templateId: z.uuid(), title: stepTitleSchema, body: richDocumentSchema,
  nodeType: z.enum(["step", "condition_group"]), parentBranchId: z.uuid().nullable(), repeatVariableId: z.uuid().nullable(),
  anchorItemId: z.uuid().nullable(), placement: z.enum(["start", "end", "before", "after"]).nullable(), position: z.int().min(0),
  deletedAt: z.string().nullable().optional() });
const groupSnapshot = z.object({ templateId: z.uuid(), rootId: z.uuid(), nodes: z.array(nodeSnapshot).min(1).max(1000),
  branches: z.array(z.object({ id: z.uuid(), groupItemId: z.uuid(), position: z.int().min(0), condition: comparisonSchema.nullable() })).max(1000) });
export async function restoreGroup(snapshot: unknown, groupId: string, actorUserId: string) {
  const saved = groupSnapshot.parse(snapshot);
  if (saved.rootId !== groupId || saved.nodes.find((row) => row.id === groupId)?.nodeType !== "condition_group" || saved.nodes.some((row) => row.templateId !== saved.templateId)) throw new OrderError("invalid_group_revision");
  return getDatabase().transaction(async (tx) => {
    await lockTemplate(tx, saved.templateId);
    const [root] = await tx.select().from(templateItems).where(eq(templateItems.id, groupId)).for("update");
    if (!root || root.templateId !== saved.templateId || root.nodeType !== "condition_group") throw new OrderError("group_not_found", 404);
    const current = await ownedForest(tx, saved.templateId, [groupId]);
    const nodeIds = new Set(saved.nodes.map((row) => row.id)), branchIds = new Set(saved.branches.map((row) => row.id));
    if (nodeIds.size !== saved.nodes.length || branchIds.size !== saved.branches.length || !nodeIds.has(groupId) ||
      current.nodes.some((row) => !nodeIds.has(row.id)) || current.branches.some((row) => !branchIds.has(row.id))) throw new OrderError("group_membership_changed", 409);
    const rows = await tx.select().from(templateItems).where(inArray(templateItems.id, [...nodeIds]));
    if (rows.length !== nodeIds.size || rows.some((row) => row.templateId !== saved.templateId || (!row.deletedAt && row.id !== groupId && !current.nodes.some((entry) => entry.id === row.id)))) throw new OrderError("group_membership_changed", 409);
    for (const branch of saved.branches) {
      await approvedCondition(tx, branch.condition);
      const [existing] = await tx.select().from(templateBranches).where(eq(templateBranches.id, branch.id));
      if (!existing || existing.groupItemId !== branch.groupItemId || !nodeIds.has(branch.groupItemId)) throw new OrderError("group_membership_changed", 409);
    }
    await snapshotGroup(tx, root, actorUserId, "pre_restore");
    for (const branch of saved.branches) await tx.update(templateBranches).set({ condition: branch.condition, position: branch.position, deletedAt: null, updatedAt: new Date() }).where(eq(templateBranches.id, branch.id));
    for (const node of saved.nodes) {
      if (node.nodeType === "step") await validateRepeatVariable(node.repeatVariableId, tx);
      const collision = await tx.select().from(templateItems).where(and(eq(templateItems.templateId, saved.templateId), eq(templateItems.position, node.position), isNull(templateItems.deletedAt)));
      if (collision.some((row) => !nodeIds.has(row.id) && row.parentBranchId === node.parentBranchId && row.anchorItemId === node.anchorItemId && row.placement === node.placement)) throw new OrderError("group_order_changed", 409);
      const previous = rows.find((row) => row.id === node.id)!;
      const { id: _, templateId: __, deletedAt, ...content } = node;
      void _; void __;
      await tx.update(templateItems).set({ ...content, deletedAt: deletedAt ? new Date(deletedAt) : null, version: previous.version + 1, updatedAt: new Date() }).where(eq(templateItems.id, node.id));
    }
    for (const node of saved.nodes) await assertPlacement(tx, await lockTemplate(tx, saved.templateId), node);
    await assertTemplateStructure(tx, saved.templateId, [...nodeIds]);
    await bumpTemplate(tx, saved.templateId);
    await recordAudit({ actorUserId, eventType: "revision.restored", entityType: "template_group", entityId: groupId, details: { templateId: saved.templateId } }, tx);
  });
}
