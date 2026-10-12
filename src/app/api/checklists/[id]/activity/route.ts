import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse } from "@/lib/input";
import { loadActivity, loadChecklist } from "@/lib/checklist-service";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(new URL(request.url).searchParams.get("page") ?? 1),
      includeDeleted = access.user.role === "admin";
    if (!(await loadChecklist(id, includeDeleted)))
      return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(await loadActivity(id, page));
  } catch (error) {
    return errorResponse(error);
  }
}
