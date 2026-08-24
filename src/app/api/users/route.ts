import { asc } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/access";

export async function GET() {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  return Response.json({ data: await getDatabase().select({ id: users.id, email: users.email, name: users.name, role: users.role, disabled: users.disabled, lastSeenAt: users.lastSeenAt }).from(users).orderBy(asc(users.email)) });
}
