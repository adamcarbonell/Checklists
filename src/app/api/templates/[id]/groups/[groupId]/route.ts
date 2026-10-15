import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { groupChangeSchema, deleteGroupSchema } from "@/lib/conditional-input";
import { changeGroup, deleteConditional } from "@/lib/conditional-service";
import { loadWorkspace } from "@/lib/workspace-data";
type Context = { params: Promise<{ id: string; groupId: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const { id, groupId } = await context.params, workspace = await loadWorkspace(id);
    const group = workspace?.steps.find((row) => row.id === groupId && row.nodeType === "condition_group");
    return Response.json(group ? { data: { ...group, branches: workspace?.branches?.filter((row) => row.groupItemId === groupId) } } : { error: "not_found" }, { status: group ? 200 : 404 });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, groupId } = await context.params;
    return Response.json({ data: await changeGroup(id, groupId, await readJson(request, groupChangeSchema), access.user.id) });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, groupId } = await context.params, input = await readJson(request, deleteGroupSchema);
    await deleteConditional(id, groupId, null, input.expectedVersion, access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
