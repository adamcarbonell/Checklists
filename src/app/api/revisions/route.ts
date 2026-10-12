import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { revisions, templateItems } from "@/db/schema";
import { requireRole } from "@/lib/access";

export async function GET(request: Request) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId)
    return Response.json({ error: "entity_required" }, { status: 400 });
  const db = getDatabase();
  const itemIds =
    entityType === "template_history"
      ? (
          await db
            .select({ id: templateItems.id })
            .from(templateItems)
            .where(eq(templateItems.templateId, entityId))
        ).map((item) => item.id)
      : [];
  const filter =
    entityType === "template_history"
      ? or(
          and(
            inArray(revisions.entityType, ["template", "template_order"]),
            eq(revisions.entityId, entityId),
          ),
          ...(itemIds.length
            ? [
                and(
                  eq(revisions.entityType, "template_item"),
                  inArray(revisions.entityId, itemIds),
                ),
              ]
            : []),
        )
      : and(
          eq(revisions.entityType, entityType),
          eq(revisions.entityId, entityId),
        );
  const rows = await db
    .select()
    .from(revisions)
    .where(filter)
    .orderBy(desc(revisions.createdAt))
    .limit(100);
  return Response.json({ data: rows });
}
