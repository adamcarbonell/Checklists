import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { changeTemplate, deleteTemplate } from "@/lib/template-service";
import { loadWorkspace } from "@/lib/workspace-data";
const schema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    expectedVersion: z.int().min(1),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
  );
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const data = await loadWorkspace(id);
    return Response.json(data ? { data } : { error: "not_found" }, {
      status: data ? 200 : 404,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    return Response.json({
      data: await changeTemplate(
        id,
        await readJson(request, schema),
        access.user.id,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(_request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    await deleteTemplate((await context.params).id, access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
