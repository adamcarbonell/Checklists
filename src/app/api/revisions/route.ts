import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { revisions } from "@/db/schema";
import { requireRole } from "@/lib/access";

export async function GET(request: Request) {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  const url = new URL(request.url); const entityType = url.searchParams.get("entityType"); const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) return Response.json({ error: "entity_required" }, { status: 400 });
  const rows = await getDatabase().select().from(revisions).where(and(eq(revisions.entityType, entityType), eq(revisions.entityId, entityId))).orderBy(desc(revisions.createdAt)).limit(100);
  return Response.json({ data: rows });
}
