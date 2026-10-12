import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { changeChecklistStep, loadChecklist } from "@/lib/checklist-service";
const schema = z
  .object({
    expectedVersion: z.int().min(1),
    status: z.enum(["pending", "completed", "skipped"]).optional(),
    notes: z.string().max(2000).optional(),
    skipReason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.notes !== undefined ||
      value.skipReason !== undefined,
  );
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; stepId: string }> },
) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const { id, stepId } = await context.params;
    z.uuid().parse(id);
    z.uuid().parse(stepId);
    await changeChecklistStep(
      id,
      stepId,
      await readJson(request, schema),
      access.user.id,
    );
    return Response.json({ data: await loadChecklist(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
