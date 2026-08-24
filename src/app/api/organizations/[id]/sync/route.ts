import { requireRole } from "@/lib/access";
import { errorResponse } from "@/lib/input";
import { syncOrganization } from "@/lib/sync-service";

export async function POST(_request: Request, context: RouteContext<"/api/organizations/[id]/sync">) {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  try { const { id } = await context.params; return Response.json({ data: await syncOrganization(id, "manual", access.user.id) }); }
  catch (error) { return errorResponse(error); }
}
