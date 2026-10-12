import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson, richDocumentSchema } from "@/lib/input";
import { createStep, changeStep, deleteStep } from "@/lib/template-service";
import { loadWorkspace } from "@/lib/workspace-data";
const create = z
  .object({
    title: z.string().trim().min(1).max(300),
    body: richDocumentSchema,
    repeatVariableId: z.uuid().nullable().optional(),
    anchorItemId: z.uuid().nullable().optional(),
    placement: z
      .enum(["start", "end", "before", "after"])
      .nullable()
      .optional(),
  })
  .strict();
const change = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: richDocumentSchema.optional(),
    repeatVariableId: z.uuid().nullable().optional(),
    expectedVersion: z.int().min(1),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.body !== undefined ||
      value.repeatVariableId !== undefined,
  );
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const data = await loadWorkspace((await context.params).id);
    return Response.json(data ? { data: data.steps } : { error: "not_found" }, {
      status: data ? 200 : 404,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    return Response.json(
      {
        data: await createStep(
          (await context.params).id,
          await readJson(request, create),
          access.user.id,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const itemId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("itemId"));
    return Response.json({
      data: await changeStep(
        (await context.params).id,
        itemId,
        await readJson(request, change),
        access.user.id,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const itemId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("itemId"));
    await deleteStep((await context.params).id, itemId, access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
