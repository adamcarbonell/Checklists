import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { revisions, templateItems } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { errorResponse } from "@/lib/input";

export async function GET(request: Request) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const url = new URL(request.url);
    const { entityType, entityId } = z
      .object({
        entityType: z.enum([
          "template_history",
          "template",
          "template_item",
          "template_order",
          "template_group",
        ]),
        entityId: z.uuid(),
      })
      .parse(Object.fromEntries(url.searchParams));
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
                    inArray(revisions.entityType, ["template_item", "template_group"]),
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
  } catch (error) {
    return errorResponse(error);
  }
}
