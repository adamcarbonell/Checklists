import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { globalSteps, organizationSteps, revisions, templateItems, templates } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit, recordRevision } from "@/lib/audit";

export async function POST(_request: Request, context: RouteContext<"/api/revisions/[id]/restore">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  const { id } = await context.params; const db = getDatabase();
  const [revision] = await db.select().from(revisions).where(eq(revisions.id, id)).limit(1);
  if (!revision) return Response.json({ error: "not_found" }, { status: 404 });
  if (revision.entityType === "template") {
    const [current] = await db.select().from(templates).where(eq(templates.id, revision.entityId)).limit(1);
    if (!current) return Response.json({ error: "entity_not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "template", entityId: current.id, action: "pre_restore", snapshot: current });
    const snapshot = revision.snapshot as typeof current;
    await db.update(templates).set({ name: snapshot.name, description: snapshot.description, deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null, updatedAt: new Date() }).where(eq(templates.id, current.id));
  } else if (revision.entityType === "global_step") {
    const [current] = await db.select().from(globalSteps).where(eq(globalSteps.id, revision.entityId)).limit(1);
    if (!current) return Response.json({ error: "entity_not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "global_step", entityId: current.id, action: "pre_restore", snapshot: current });
    const snapshot = revision.snapshot as typeof current;
    await db.update(globalSteps).set({ title: snapshot.title, body: snapshot.body, repeatVariableId: snapshot.repeatVariableId, deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null, updatedAt: new Date() }).where(eq(globalSteps.id, current.id));
  } else if (revision.entityType === "template_item") {
    const [current] = await db.select().from(templateItems).where(eq(templateItems.id, revision.entityId)).limit(1);
    if (!current) return Response.json({ error: "entity_not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "template_item", entityId: current.id, action: "pre_restore", snapshot: current });
    const snapshot = revision.snapshot as typeof current;
    await db.update(templateItems).set({ snapshotTitle: snapshot.snapshotTitle, snapshotBody: snapshot.snapshotBody, snapshotRepeatVariableId: snapshot.snapshotRepeatVariableId, anchorItemId: snapshot.anchorItemId, placement: snapshot.placement, position: snapshot.position, deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null, updatedAt: new Date() }).where(eq(templateItems.id, current.id));
  } else if (revision.entityType === "organization_step") {
    const [current] = await db.select().from(organizationSteps).where(eq(organizationSteps.id, revision.entityId)).limit(1);
    if (!current) return Response.json({ error: "entity_not_found" }, { status: 404 });
    await recordRevision({ actorUserId: access.user.id, entityType: "organization_step", entityId: current.id, action: "pre_restore", snapshot: current });
    const snapshot = revision.snapshot as typeof current;
    await db.update(organizationSteps).set({ title: snapshot.title, body: snapshot.body, repeatVariableId: snapshot.repeatVariableId, deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null, updatedAt: new Date() }).where(eq(organizationSteps.id, current.id));
  } else return Response.json({ error: "restore_not_supported" }, { status: 400 });
  await recordAudit({ actorUserId: access.user.id, eventType: "revision.restored", entityType: revision.entityType, entityId: revision.entityId, details: { revisionId: revision.id } });
  return Response.json({ restored: true });
}
