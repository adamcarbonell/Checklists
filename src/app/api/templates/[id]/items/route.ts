import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { globalSteps, organizationSteps, templateItems, templates } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";
import { errorResponse, readJson, richDocumentSchema } from "@/lib/input";

const itemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global"), globalStepId: z.uuid(), position: z.int().min(0) }),
  z.object({ kind: z.literal("organization"), organizationId: z.uuid(), sourceOrganizationStepId: z.uuid(), anchorItemId: z.uuid(), placement: z.enum(["before", "after"]), position: z.int().min(0) }),
]);
const snapshotUpdateSchema = z.object({ title: z.string().trim().min(1).max(300).optional(), body: richDocumentSchema.optional(), repeatVariableId: z.uuid().nullable().optional() }).refine((value) => Object.keys(value).length > 0);

export async function GET(_request: Request, context: RouteContext<"/api/templates/[id]/items">) {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  const { id } = await context.params;
  return Response.json({ data: await getDatabase().select().from(templateItems).where(and(eq(templateItems.templateId, id), isNull(templateItems.deletedAt))).orderBy(asc(templateItems.position)) });
}

export async function POST(request: Request, context: RouteContext<"/api/templates/[id]/items">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const input = await readJson(request, itemSchema);
    const db = getDatabase();
    const [template] = await db.select({ id: templates.id }).from(templates).where(and(eq(templates.id, id), isNull(templates.deletedAt))).limit(1);
    if (!template) return Response.json({ error: "template_not_found" }, { status: 404 });
    if (input.kind === "global") {
      const [step] = await db.select({ id: globalSteps.id }).from(globalSteps).where(and(eq(globalSteps.id, input.globalStepId), isNull(globalSteps.deletedAt))).limit(1);
      if (!step) return Response.json({ error: "global_step_not_found" }, { status: 404 });
      const [created] = await db.insert(templateItems).values({ templateId: id, kind: "global", globalStepId: step.id, position: input.position }).returning();
      return Response.json({ data: created }, { status: 201 });
    }
    const [source] = await db.select().from(organizationSteps).where(and(eq(organizationSteps.id, input.sourceOrganizationStepId), eq(organizationSteps.organizationId, input.organizationId), isNull(organizationSteps.deletedAt))).limit(1);
    if (!source) return Response.json({ error: "organization_step_not_found" }, { status: 404 });
    const [anchor] = await db.select({ id: templateItems.id }).from(templateItems).where(and(eq(templateItems.id, input.anchorItemId), eq(templateItems.templateId, id), eq(templateItems.kind, "global"), isNull(templateItems.deletedAt))).limit(1);
    if (!anchor) return Response.json({ error: "anchor_not_found" }, { status: 409 });
    const [created] = await db.insert(templateItems).values({ templateId: id, kind: "organization", organizationId: input.organizationId, sourceOrganizationStepId: source.id, snapshotTitle: source.title, snapshotBody: source.body, snapshotRepeatVariableId: source.repeatVariableId, anchorItemId: anchor.id, placement: input.placement, position: input.position }).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "template.organization_snapshot_added", entityType: "template", entityId: id, details: { itemId: created.id, organizationId: input.organizationId, sourceOrganizationStepId: source.id } });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/templates/[id]/items">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const itemId = new URL(request.url).searchParams.get("itemId");
    if (!itemId) return Response.json({ error: "item_id_required" }, { status: 400 });
    const input = await readJson(request, snapshotUpdateSchema);
    const db = getDatabase();
    const [existing] = await db.select().from(templateItems).where(and(eq(templateItems.id, itemId), eq(templateItems.templateId, id), eq(templateItems.kind, "organization"), isNull(templateItems.deletedAt))).limit(1);
    if (!existing) return Response.json({ error: "organization_snapshot_not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "template_item", entityId: itemId, action: "update", snapshot: existing });
    const [updated] = await db.update(templateItems).set({
      ...(input.title !== undefined ? { snapshotTitle: input.title } : {}),
      ...(input.body !== undefined ? { snapshotBody: input.body } : {}),
      ...(input.repeatVariableId !== undefined ? { snapshotRepeatVariableId: input.repeatVariableId } : {}),
      updatedAt: new Date(),
    }).where(eq(templateItems.id, itemId)).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "template.organization_snapshot_updated", entityType: "template", entityId: id, details: { itemId, fields: Object.keys(input) } });
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/templates/[id]/items">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  const { id } = await context.params;
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId) return Response.json({ error: "item_id_required" }, { status: 400 });
  const db = getDatabase();
  const [existing] = await db.select().from(templateItems).where(and(eq(templateItems.id, itemId), eq(templateItems.templateId, id), isNull(templateItems.deletedAt))).limit(1);
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
  await recordRevision({ actorUserId: access.user.id, entityType: "template_item", entityId: itemId, action: "delete", snapshot: existing });
  await db.update(templateItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(templateItems.id, itemId));
  await recordAudit({ actorUserId: access.user.id, eventType: "template.item_deleted", entityType: "template", entityId: id, details: { itemId } });
  return new Response(null, { status: 204 });
}
