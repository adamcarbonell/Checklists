import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse, readJson } from "@/lib/input";

const userUpdateSchema = z.object({ role: z.enum(["admin", "editor", "viewer"]).optional(), disabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: RouteContext<"/api/users/[id]">) {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    if (id === access.user.id) return Response.json({ error: "cannot_change_own_access" }, { status: 409 });
    const input = await readJson(request, userUpdateSchema);
    const [updated] = await getDatabase().update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, id)).returning({ id: users.id, email: users.email, name: users.name, role: users.role, disabled: users.disabled });
    if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
    await recordAudit({ actorUserId: access.user.id, eventType: "user.access_updated", entityType: "user", entityId: id, details: input });
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}
