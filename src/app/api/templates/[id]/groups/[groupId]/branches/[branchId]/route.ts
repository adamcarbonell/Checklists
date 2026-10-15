import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { branchChangeSchema, deleteGroupSchema } from "@/lib/conditional-input";
import { writeBranch, deleteConditional } from "@/lib/conditional-service";
import { loadWorkspace } from "@/lib/workspace-data";
type Context = { params: Promise<{ id: string; groupId: string; branchId: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const { id, groupId, branchId } = await context.params, workspace = await loadWorkspace(id);
    const branch = workspace?.branches?.find((row) => row.id === branchId && row.groupItemId === groupId);
    return Response.json(branch ? { data: branch } : { error: "not_found" }, { status: branch ? 200 : 404 });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, groupId, branchId } = await context.params;
    return Response.json({ data: await writeBranch(id, groupId, branchId, await readJson(request, branchChangeSchema), access.user.id) });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, groupId, branchId } = await context.params, input = await readJson(request, deleteGroupSchema);
    await deleteConditional(id, groupId, branchId, input.expectedVersion, access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
