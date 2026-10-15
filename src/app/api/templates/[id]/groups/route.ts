import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { groupCreateSchema } from "@/lib/conditional-input";
import { createGroup } from "@/lib/conditional-service";
import { loadWorkspace } from "@/lib/workspace-data";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const workspace = await loadWorkspace((await context.params).id);
    return Response.json(workspace ? { data: { groups: workspace.steps.filter((node) => node.nodeType === "condition_group"), branches: workspace.branches } } : { error: "not_found" }, { status: workspace ? 200 : 404 });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    return Response.json({ data: await createGroup((await context.params).id, await readJson(request, groupCreateSchema), access.user.id) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
