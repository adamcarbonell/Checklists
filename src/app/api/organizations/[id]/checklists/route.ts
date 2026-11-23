import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { createChecklist, listChecklists } from "@/lib/checklist-service";

const create = z.strictObject({
  templateId: z.uuid(), folderId: z.uuid(), creationKey: z.uuid(),
  name: z.string().trim().min(1).max(160).optional(),
});
const list = z.strictObject({
  folderId: z.uuid().optional(),
  status: z.enum(["active", "completed"]).optional(),
  search: z.string().trim().max(160).optional(),
  includeDeleted: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});
type Context = RouteContext<"/api/organizations/[id]/checklists">;

export async function GET(request: Request, { params }: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const organizationId = z.uuid().parse((await params).id);
    const query = list.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (query.includeDeleted === "true" && access.user.role !== "admin")
      return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json(await listChecklists({ ...query, organizationId, includeDeleted: query.includeDeleted === "true" }));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const organizationId = z.uuid().parse((await params).id);
    const input = await readJson(request, create);
    const { id } = await createChecklist({ ...input, organizationId }, access.user.id);
    return Response.json({ data: { id } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
