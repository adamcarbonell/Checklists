import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { saveOrder } from "@/lib/order-service";
import { OrderError } from "@/lib/template-order";
const entry = z.object({
  itemId: z.uuid(),
  position: z.int().min(0),
  anchorItemId: z.uuid().nullable(),
  placement: z.enum(["before", "after"]).nullable(),
});
const schema = z.object({
  organizationId: z.uuid().nullable(),
  movedItemId: z.uuid(),
  expectedOrder: z.array(entry).max(1000),
  proposedOrder: z.array(entry).max(1000),
});
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const input = await readJson(request, schema);
    return Response.json({ data: await saveOrder(id, input, access.user.id) });
  } catch (error) {
    if (error instanceof OrderError)
      return Response.json({ error: error.message }, { status: error.status });
    return errorResponse(error);
  }
}
