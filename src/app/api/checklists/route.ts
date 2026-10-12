import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { createChecklist, listChecklists } from "@/lib/checklist-service";
const create = z
  .object({
    templateId: z.uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    creationKey: z.uuid(),
  })
  .strict();
export async function GET(request: Request) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const query = z
      .object({
        organizationId: z.uuid().optional(),
        status: z.enum(["active", "completed"]).optional(),
        search: z.string().trim().max(160).optional(),
        includeDeleted: z.enum(["true", "false"]).optional(),
        page: z.coerce.number().int().min(1).max(100000).optional(),
      })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    if (query.includeDeleted === "true" && access.user.role !== "admin")
      return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json(
      await listChecklists({
        ...query,
        includeDeleted: query.includeDeleted === "true",
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    return Response.json(
      {
        data: await createChecklist(
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
