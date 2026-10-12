import { requireRole } from "@/lib/access";
import { loadWorkspace } from "@/lib/workspace-data";
import { errorResponse } from "@/lib/input";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const data = await loadWorkspace(id);
    return data
      ? Response.json({ data })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
