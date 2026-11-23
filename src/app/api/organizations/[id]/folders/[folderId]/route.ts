import { z } from "zod";
import { requireRole } from "@/lib/access";
import { changeChecklistFolder } from "@/lib/checklist-folders";
import { errorResponse, readJson } from "@/lib/input";

const rename = z.strictObject({ name: z.string().trim().min(1).max(100) });
const route = z.object({ id: z.uuid(), folderId: z.uuid() });
type Context = RouteContext<"/api/organizations/[id]/folders/[folderId]">;

export async function PATCH(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, folderId } = route.parse(await context.params);
    const input = await readJson(request, rename);
    const data = await changeChecklistFolder(id, { action: "rename", id: folderId, ...input }, access.user.id);
    return Response.json({ data });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, folderId } = route.parse(await context.params);
    await changeChecklistFolder(id, { action: "delete", id: folderId }, access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
