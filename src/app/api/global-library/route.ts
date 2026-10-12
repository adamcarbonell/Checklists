import { requireRole } from "@/lib/access";
import { loadDefinitions, loadLibrary } from "@/lib/workspace-data";
import { errorResponse } from "@/lib/input";
export async function GET() {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const [steps, definitions] = await Promise.all([
      loadLibrary(),
      loadDefinitions(),
    ]);
    return Response.json({ data: { steps, definitions } });
  } catch (error) {
    return errorResponse(error);
  }
}
