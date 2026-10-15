import { requireRole } from "@/lib/access";
import { errorResponse, readJson } from "@/lib/input";
import { branchChangeSchema } from "@/lib/conditional-input";
import { writeBranch } from "@/lib/conditional-service";
export async function POST(request: Request, context: { params: Promise<{ id: string; groupId: string }> }) {
  const access = await requireRole("editor");
  if (!access.ok) return access.response;
  try {
    const { id, groupId } = await context.params;
    return Response.json({ data: await writeBranch(id, groupId, null, await readJson(request, branchChangeSchema), access.user.id) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
