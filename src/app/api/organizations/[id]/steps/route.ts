import { and, asc, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { organizationSteps, organizations } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse, readJson, stepCreateSchema } from "@/lib/input";

export async function GET(_request: Request, context: RouteContext<"/api/organizations/[id]/steps">) {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  const { id } = await context.params;
  return Response.json({ data: await getDatabase().select().from(organizationSteps).where(and(eq(organizationSteps.organizationId, id), isNull(organizationSteps.deletedAt))).orderBy(asc(organizationSteps.title)) });
}

export async function POST(request: Request, context: RouteContext<"/api/organizations/[id]/steps">) {
  const access = await requireRole("editor"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const db = getDatabase();
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, id), isNull(organizations.deletedAt))).limit(1);
    if (!organization) return Response.json({ error: "organization_not_found" }, { status: 404 });
    const input = await readJson(request, stepCreateSchema);
    const [created] = await db.insert(organizationSteps).values({ organizationId: id, ...input }).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "organization_step.created", entityType: "organization_step", entityId: created.id, details: { organizationId: id, title: created.title } });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
