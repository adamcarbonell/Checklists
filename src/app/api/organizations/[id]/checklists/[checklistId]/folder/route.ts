import { z } from "zod";
import { requireRole } from "@/lib/access";
import { moveChecklist } from "@/lib/checklist-service";
import { errorResponse, readJson } from "@/lib/input";

const move = z.strictObject({ folderId: z.uuid(), expectedFolderId: z.uuid().nullable() });
const route = z.object({ id: z.uuid(), checklistId: z.uuid() });

export async function PATCH(request: Request, context: RouteContext<"/api/organizations/[id]/checklists/[checklistId]/folder">) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, checklistId } = route.parse(await context.params);
    await moveChecklist(id, checklistId, await readJson(request, move), access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
