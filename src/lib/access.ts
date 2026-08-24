import { auth, authConfigured } from "@/auth";
import { roleAllows, type AppRole } from "./roles";

export type { AppRole } from "./roles";

export async function currentUser() {
  if (!authConfigured && process.env.NODE_ENV !== "production") return { id: "development-admin", email: "adam@version2llc.com", name: "Adam Carbonell", role: "admin" as const };
  const session = await auth();
  return session?.user ? { id: session.user.id, email: session.user.email ?? "", name: session.user.name ?? "", role: session.user.role } : null;
}

export async function requireRole(minimum: AppRole) {
  const user = await currentUser();
  if (!user) return { ok: false as const, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (!roleAllows(user.role, minimum)) return { ok: false as const, response: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true as const, user };
}
