import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse } from "@/lib/input";
import { loadChecklist, setChecklistDeleted } from "@/lib/checklist-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id),
      includeDeleted =
        new URL(request.url).searchParams.get("includeDeleted") === "true";
    if (includeDeleted && access.user.role !== "admin")
      return Response.json({ error: "forbidden" }, { status: 403 });
    const data = await loadChecklist(id, includeDeleted);
    return Response.json(data ? { data } : { error: "not_found" }, {
      status: data ? 200 : 404,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(_request: Request, context: Context) {
  const access = await requireRole("admin");
  if (!access.ok) return access.response;
  try {
    await setChecklistDeleted(
      z.uuid().parse((await context.params).id),
      true,
      access.user.id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
