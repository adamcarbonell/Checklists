import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { saveOrder } from "@/lib/order-service";
import { loadWorkspace } from "@/lib/workspace-data";
const entry = z
  .object({
    itemId: z.uuid(),
    position: z.int().min(0),
    anchorItemId: z.uuid().nullable(),
    parentBranchId: z.uuid().nullable().optional(),
    placement: z.enum(["start", "end", "before", "after"]).nullable(),
  })
  .strict();
const schema = z
  .object({
    movedItemId: z.uuid(),
    expectedVersion: z.int().min(1),
    expectedParentVersion: z.int().min(1).nullable(),
    expectedOrder: z.array(entry).max(1000),
    proposedOrder: z.array(entry).max(1000),
  })
  .strict();
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    await saveOrder(id, await readJson(request, schema), access.user.id);
    return Response.json({ data: await loadWorkspace(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
