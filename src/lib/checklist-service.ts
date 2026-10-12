import {
  and,
  asc,
  desc,
  eq,
  isNull,
  sql,
  count,
  ilike,
  or,
  inArray,
} from "drizzle-orm";
import { getDatabase } from "@/db/client";
import {
  checklistActivity,
  checklists,
  checklistSteps,
  users,
} from "@/db/schema";
import { loadTemplateContext, loadWorkspace } from "./workspace-data";
import { lockTemplate } from "./template-service";
import { OrderError } from "./template-order";
import { recordAudit } from "./audit";
import type {
  ActivityEntry,
  ChecklistDetail,
  ChecklistSummary,
} from "./workspace-types";
import type { RichNode } from "./template-engine";
export async function createChecklist(
  input: { templateId: string; name?: string; creationKey: string },
  actorUserId: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await createChecklistAttempt(input, actorUserId);
    } catch (error) {
      const code =
        (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
        (error as { code?: string })?.code;
      if (
        code !== "40001" &&
        code !== "23505" &&
        !(error instanceof OrderError && error.message === "creation_retry")
      )
        throw error;
    }
  }
  throw new OrderError("creation_busy_retry", 409);
}
async function createChecklistAttempt(
  input: { templateId: string; name?: string; creationKey: string },
  actorUserId: string,
) {
  return getDatabase().transaction(
    async (tx) => {
      // Lock the actor to serialize retries with the same idempotency key.
      const [actor] = await tx
        .select({ id: users.id, disabled: users.disabled })
        .from(users)
        .where(eq(users.id, actorUserId))
        .for("update");
      if (!actor || actor.disabled) throw new OrderError("unauthorized", 401);
      const [existing] = await tx
        .select()
        .from(checklists)
        .where(
          and(
            eq(checklists.createdBy, actorUserId),
            eq(checklists.creationKey, input.creationKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.deletedAt ||
          existing.templateId !== input.templateId ||
          (input.name && existing.name !== input.name)
        )
          throw new OrderError("creation_key_conflict", 409);
        return existing;
      }
      const template = await lockTemplate(tx, input.templateId);
      if (
        template.scope !== "organization" ||
        !template.organizationId ||
        !template.globalTemplateId
      )
        throw new OrderError("org_template_required");
      const workspace = await loadWorkspace(template.id, tx),
        context = await loadTemplateContext(
          template.id,
          template.organizationId,
          tx,
        );
      if (!workspace || !context)
        throw new OrderError("organization_unavailable", 409);
      if (!context.steps.length) throw new OrderError("empty_checklist", 409);
      if (!context.valid)
        throw new OrderError("checklist_context_invalid", 409);
      if (context.steps.length > 1000)
        throw new OrderError("checklist_step_limit", 409);
      const variableSnapshot = Object.fromEntries(
        context.variables
          .filter((variable) => variable.used)
          .map((variable) => [
            variable.key,
            { value: variable.value, syncedAt: variable.syncedAt },
          ]),
      );
      const [created] = await tx
        .insert(checklists)
        .values({
          name: input.name || template.name,
          organizationId: template.organizationId,
          organizationName: workspace.organizationName!,
          templateId: template.id,
          templateName: template.name,
          globalTemplateId: template.globalTemplateId,
          templateVersion: context.templateVersion,
          globalTemplateVersion: context.parentVersion!,
          variableSnapshot,
          creationKey: input.creationKey,
          createdBy: actorUserId,
        })
        .onConflictDoNothing({
          target: [checklists.createdBy, checklists.creationKey],
        })
        .returning();
      if (!created) throw new OrderError("creation_retry", 409);
      // Batches avoid PostgreSQL parameter limits without truncating the snapshot.
      for (let offset = 0; offset < context.steps.length; offset += 100)
        await tx
          .insert(checklistSteps)
          .values(
            context.steps
              .slice(offset, offset + 100)
              .map((step, index) => ({
                checklistId: created.id,
                sourceItemId: step.sourceItemId,
                repeatIndex: step.repeatIndex,
                position: offset + index + 1,
                title: step.title,
                body: step.body,
              })),
          );
      await tx
        .insert(checklistActivity)
        .values({
          checklistId: created.id,
          actorUserId,
          event: "created",
          changes: {
            templateVersion: created.templateVersion,
            globalTemplateVersion: created.globalTemplateVersion,
            stepCount: context.steps.length,
          },
        });
      await recordAudit(
        {
          actorUserId,
          eventType: "checklist.created",
          entityType: "checklist",
          entityId: created.id,
          details: {
            templateId: template.id,
            organizationId: template.organizationId,
          },
        },
        tx,
      );
      return created;
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function changeChecklistStep(
  id: string,
  stepId: string,
  input: {
    expectedVersion: number;
    status?: "pending" | "completed" | "skipped";
    notes?: string;
    skipReason?: string;
  },
  actorUserId: string,
) {
  return getDatabase().transaction(async (tx) => {
    const [actor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, actorUserId), eq(users.disabled, false)))
      .limit(1);
    if (!actor) throw new OrderError("unauthorized", 401);
    // Checklist lock serializes aggregate completion and concurrent step updates.
    const [checklist] = await tx
      .select()
      .from(checklists)
      .where(and(eq(checklists.id, id), isNull(checklists.deletedAt)))
      .for("update");
    if (!checklist) throw new OrderError("checklist_not_found", 404);
    const [current] = await tx
      .select()
      .from(checklistSteps)
      .where(
        and(eq(checklistSteps.id, stepId), eq(checklistSteps.checklistId, id)),
      )
      .for("update");
    if (!current) throw new OrderError("step_not_found", 404);
    if (current.version !== input.expectedVersion)
      throw new OrderError("step_changed_reload", 409);
    const status = input.status ?? current.status,
      notes = input.notes ?? current.notes,
      skipReason =
        status === "skipped"
          ? (input.skipReason ?? current.skipReason).trim()
          : "";
    if (notes.length > 2000 || skipReason.length > 2000)
      throw new OrderError("notes_too_long");
    if (status === "skipped" && !skipReason)
      throw new OrderError("skip_reason_required");
    const now = new Date(),
      stateChanged =
        status !== current.status || skipReason !== current.skipReason,
      notesChanged = notes !== current.notes;
    const [updated] = await tx
      .update(checklistSteps)
      .set({
        status,
        notes,
        skipReason,
        version: current.version + 1,
        updatedAt: now,
        ...(stateChanged
          ? { statusChangedBy: actorUserId, statusChangedAt: now }
          : {}),
        ...(notesChanged
          ? { notesChangedBy: actorUserId, notesChangedAt: now }
          : {}),
      })
      .where(eq(checklistSteps.id, stepId))
      .returning();
    const statuses = await tx
      .select({ status: checklistSteps.status })
      .from(checklistSteps)
      .where(eq(checklistSteps.checklistId, id));
    const nextStatus = statuses.every((step) => step.status !== "pending")
      ? "completed"
      : "active";
    await tx
      .update(checklists)
      .set({
        status: nextStatus,
        completedAt:
          nextStatus === "completed" ? (checklist.completedAt ?? now) : null,
        updatedAt: now,
      })
      .where(eq(checklists.id, id));
    await tx
      .insert(checklistActivity)
      .values({
        checklistId: id,
        stepId,
        actorUserId,
        event: "step_updated",
        changes: {
          before: {
            status: current.status,
            notes: current.notes,
            skipReason: current.skipReason,
          },
          after: { status, notes, skipReason },
          version: updated.version,
        },
      });
    if (nextStatus !== checklist.status)
      await tx
        .insert(checklistActivity)
        .values({
          checklistId: id,
          actorUserId,
          event: nextStatus === "completed" ? "completed" : "reopened",
          changes: {},
        });
    await recordAudit(
      {
        actorUserId,
        eventType: "checklist.step_updated",
        entityType: "checklist",
        entityId: id,
        details: { stepId, status, version: updated.version, notesChanged },
      },
      tx,
    );
    return updated;
  });
}
function summary(
  row: typeof checklists.$inferSelect,
  stats: { completed: number; skipped: number; total: number },
): ChecklistSummary {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    templateName: row.templateName,
    status: row.status,
    ...stats,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
export async function listChecklists(
  filters: {
    organizationId?: string;
    status?: "active" | "completed";
    search?: string;
    includeDeleted?: boolean;
    page?: number;
  } = {},
) {
  const db = getDatabase(),
    conditions = and(
      filters.includeDeleted ? undefined : isNull(checklists.deletedAt),
      filters.organizationId
        ? eq(checklists.organizationId, filters.organizationId)
        : undefined,
      filters.status ? eq(checklists.status, filters.status) : undefined,
      filters.search
        ? or(
            ilike(checklists.name, "%" + escapeLike(filters.search) + "%"),
            ilike(
              checklists.organizationName,
              "%" + escapeLike(filters.search) + "%",
            ),
          )
        : undefined,
    );
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(checklists)
      .where(conditions)
      .orderBy(desc(checklists.createdAt), desc(checklists.id))
      .limit(50)
      .offset(((filters.page ?? 1) - 1) * 50),
    db.select({ value: count() }).from(checklists).where(conditions),
  ]);
  const grouped = rows.length
    ? await db
        .select({
          checklistId: checklistSteps.checklistId,
          total: count(),
          completed: sql<number>`count(*) filter (where ${checklistSteps.status}='completed')::int`,
          skipped: sql<number>`count(*) filter (where ${checklistSteps.status}='skipped')::int`,
        })
        .from(checklistSteps)
        .where(
          inArray(
            checklistSteps.checklistId,
            rows.map((row) => row.id),
          ),
        )
        .groupBy(checklistSteps.checklistId)
    : [];
  const statistics = new Map(
    grouped.map((stats) => [
      stats.checklistId,
      {
        total: Number(stats.total),
        completed: Number(stats.completed),
        skipped: Number(stats.skipped),
      },
    ]),
  );
  const data = rows.map((row) =>
    summary(
      row,
      statistics.get(row.id) ?? { total: 0, completed: 0, skipped: 0 },
    ),
  );
  return {
    data,
    total: Number(totalRows[0].value),
    page: filters.page ?? 1,
    pageSize: 50,
  };
}
export async function loadChecklist(
  id: string,
  includeDeleted = false,
): Promise<ChecklistDetail | null> {
  const db = getDatabase(),
    [row] = await db
      .select()
      .from(checklists)
      .where(
        and(
          eq(checklists.id, id),
          includeDeleted ? undefined : isNull(checklists.deletedAt),
        ),
      )
      .limit(1);
  if (!row) return null;
  const steps = await db
    .select()
    .from(checklistSteps)
    .where(eq(checklistSteps.checklistId, id))
    .orderBy(asc(checklistSteps.position));
  const actorIds = [
    ...new Set(
      steps
        .flatMap((step) => [step.statusChangedBy, step.notesChangedBy])
        .filter((id): id is string => !!id),
    ),
  ];
  const actors = actorIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  return {
    ...summary(row, {
      total: steps.length,
      completed: steps.filter((step) => step.status === "completed").length,
      skipped: steps.filter((step) => step.status === "skipped").length,
    }),
    templateId: row.templateId,
    globalTemplateId: row.globalTemplateId,
    templateVersion: row.templateVersion,
    globalTemplateVersion: row.globalTemplateVersion,
    variableSnapshot: row.variableSnapshot,
    people: Object.fromEntries(
      actors.map((actor) => [actor.id, actor.name || actor.email]),
    ),
    steps: steps.map((step) => ({
      id: step.id,
      sourceItemId: step.sourceItemId,
      repeatIndex: step.repeatIndex,
      position: step.position,
      title: step.title,
      body: step.body as RichNode,
      status: step.status,
      notes: step.notes,
      skipReason: step.skipReason,
      version: step.version,
      statusChangedBy: step.statusChangedBy,
      statusChangedAt: step.statusChangedAt?.toISOString() ?? null,
      notesChangedBy: step.notesChangedBy,
      notesChangedAt: step.notesChangedAt?.toISOString() ?? null,
    })),
  };
}
export async function loadActivity(
  id: string,
  page = 1,
): Promise<{ data: ActivityEntry[]; page: number; hasMore: boolean }> {
  const rows = await getDatabase()
    .select({
      id: checklistActivity.id,
      stepId: checklistActivity.stepId,
      actor: users.name,
      email: users.email,
      event: checklistActivity.event,
      changes: checklistActivity.changes,
      createdAt: checklistActivity.createdAt,
    })
    .from(checklistActivity)
    .innerJoin(users, eq(users.id, checklistActivity.actorUserId))
    .where(eq(checklistActivity.checklistId, id))
    .orderBy(desc(checklistActivity.createdAt), desc(checklistActivity.id))
    .limit(51)
    .offset((page - 1) * 50);
  return {
    data: rows
      .slice(0, 50)
      .map((row) => ({
        id: row.id,
        stepId: row.stepId,
        actor: row.actor || row.email,
        event: row.event,
        changes: row.changes,
        createdAt: row.createdAt.toISOString(),
      })),
    page,
    hasMore: rows.length > 50,
  };
}
export async function setChecklistDeleted(
  id: string,
  deleted: boolean,
  actorUserId: string,
) {
  await getDatabase().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(checklists)
      .where(eq(checklists.id, id))
      .for("update");
    if (!row) throw new OrderError("checklist_not_found", 404);
    await tx
      .update(checklists)
      .set({ deletedAt: deleted ? new Date() : null, updatedAt: new Date() })
      .where(eq(checklists.id, id));
    await tx
      .insert(checklistActivity)
      .values({
        checklistId: id,
        actorUserId,
        event: deleted ? "deleted" : "restored",
        changes: {},
      });
    await recordAudit(
      {
        actorUserId,
        eventType: deleted ? "checklist.deleted" : "checklist.restored",
        entityType: "checklist",
        entityId: id,
      },
      tx,
    );
  });
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
