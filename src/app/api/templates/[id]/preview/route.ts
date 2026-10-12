import { requireRole } from "@/lib/access";
import { loadTemplateContext } from "@/lib/workspace-data";
import { errorResponse } from "@/lib/input";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  if (!organizationId)
    return Response.json(
      { error: "organization_id_required" },
      { status: 400 },
    );
  try {
    const { id } = await context.params;
    const result = await loadTemplateContext(id, organizationId);
    return result
      ? Response.json({
          data: {
            steps: result.steps,
            issues: result.issues,
            valid: result.valid,
          },
          validation: {
            valid: result.valid,
            invalidVariables: result.invalidVariables,
          },
        })
      : Response.json(
          { error: "template_or_organization_not_found" },
          { status: 404 },
        );
  } catch (error) {
    return errorResponse(error);
  }
}
