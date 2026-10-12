import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { createTemplate } from "@/lib/template-service";
import { loadTemplates } from "@/lib/workspace-data";
const schema = z
  .object({
    scope: z.enum(["global", "organization"]),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    organizationId: z.uuid().optional(),
    globalTemplateId: z.uuid().optional(),
  })
  .strict();
export async function GET(request: Request) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const query = z
      .object({
        scope: z.enum(["global", "organization"]).optional(),
        organizationId: z.uuid().optional(),
        includeDeleted: z.enum(["true", "false"]).optional(),
      })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({
      data: await loadTemplates({
        ...query,
        includeDeleted: query.includeDeleted === "true",
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    return Response.json(
      {
        data: await createTemplate(
          await readJson(request, schema),
          access.user.id,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
