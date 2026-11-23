import { z } from "zod";
import { requireRole } from "@/lib/access";
import { changeChecklistFolder } from "@/lib/checklist-folders";
import { errorResponse, readJson } from "@/lib/input";

const create = z.strictObject({ name: z.string().trim().min(1).max(100) });

export async function POST(request: Request, context: RouteContext<"/api/organizations/[id]/folders">) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const organizationId = z.uuid().parse((await context.params).id);
    const input = await readJson(request, create);
    const data = await changeChecklistFolder(organizationId, { action: "create", ...input }, access.user.id);
    return Response.json({ data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
