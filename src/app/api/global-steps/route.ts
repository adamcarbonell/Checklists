import { asc, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { globalSteps } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse, readJson, stepCreateSchema } from "@/lib/input";

export async function GET() {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  return Response.json({ data: await getDatabase().select().from(globalSteps).where(isNull(globalSteps.deletedAt)).orderBy(asc(globalSteps.title)) });
}

export async function POST(request: Request) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const input = await readJson(request, stepCreateSchema);
    const [created] = await getDatabase().insert(globalSteps).values(input).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "global_step.created", entityType: "global_step", entityId: created.id, details: { title: created.title } });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
