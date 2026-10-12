import { z } from "zod";
import { requireRole } from "@/lib/access";
import { errorResponse } from "@/lib/input";
import { setChecklistDeleted } from "@/lib/checklist-service";
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireRole("admin");
  if (!access.ok) return access.response;
  try {
    await setChecklistDeleted(
      z.uuid().parse((await context.params).id),
      false,
      access.user.id,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
