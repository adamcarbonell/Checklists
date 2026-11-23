import { z } from "zod";
import { requireRole } from "@/lib/access";
import { changeChecklists } from "@/lib/checklist-service";
import { errorResponse, readJson } from "@/lib/input";

const selection = {
  checklistIds: z.array(z.uuid().toLowerCase()).min(1).max(50)
    .refine((ids) => ids.length === new Set(ids).size),
  expectedFolderId: z.uuid().toLowerCase().nullable(),
};
const batch = z.discriminatedUnion("action", [
  z.strictObject({ ...selection, action: z.literal("move"), folderId: z.uuid().toLowerCase() }),
  z.strictObject({ ...selection, action: z.literal("delete") }),
]);

export async function POST(request: Request, context: RouteContext<"/api/organizations/[id]/checklists/bulk">) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id);
    const input = await readJson(request, batch);
    if (input.action === "delete" && access.user.role !== "admin") {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    await changeChecklists(id, input, access.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
