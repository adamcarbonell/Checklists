import { asc, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { templates } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse, readJson, templateCreateSchema } from "@/lib/input";

export async function GET() {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  const rows = await getDatabase().select().from(templates).where(isNull(templates.deletedAt)).orderBy(asc(templates.name));
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const input = await readJson(request, templateCreateSchema);
    const [created] = await getDatabase().insert(templates).values(input).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "template.created", entityType: "template", entityId: created.id, details: { name: created.name } });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
