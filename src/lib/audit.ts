import { auditEvents, revisions } from "@/db/schema";
import { getDatabase } from "@/db/client";
import { and, desc, eq } from "drizzle-orm";

export async function recordAudit(input: { actorUserId?: string; eventType: string; entityType?: string; entityId?: string; details?: Record<string, unknown> }) {
  await getDatabase().insert(auditEvents).values({ actorUserId: databaseUserId(input.actorUserId), eventType: input.eventType, entityType: input.entityType, entityId: input.entityId, details: input.details ?? {} });
}

export async function recordRevision(input: { actorUserId?: string; entityType: string; entityId: string; action: string; snapshot: Record<string, unknown> }) {
  const db = getDatabase();
  if (input.action === "update") {
    const [latest] = await db.select({ createdAt: revisions.createdAt }).from(revisions).where(and(eq(revisions.entityType, input.entityType), eq(revisions.entityId, input.entityId), eq(revisions.action, "update"))).orderBy(desc(revisions.createdAt)).limit(1);
    if (latest && Date.now() - latest.createdAt.getTime() < 30_000) return;
  }
  await db.insert(revisions).values({ actorUserId: databaseUserId(input.actorUserId), entityType: input.entityType, entityId: input.entityId, action: input.action, snapshot: input.snapshot });
}

function databaseUserId(userId?: string) { return userId && userId !== "development-admin" ? userId : undefined; }
