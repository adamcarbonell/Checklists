import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AdminShell } from "@/components/admin-shell";
import { UserRoleManager } from "@/components/user-role-manager";
import { getDatabase, hasDatabase } from "@/db/client";
import { users } from "@/db/schema";
import { currentUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export default async function UsersPage() {
  const user = await currentUser(); if (!user) redirect("/api/auth/signin?callbackUrl=/admin/users"); if (user.role !== "admin") redirect("/");
  const rows = hasDatabase() ? await getDatabase().select({ id: users.id, email: users.email, name: users.name, role: users.role, disabled: users.disabled, lastSeenAt: users.lastSeenAt }).from(users).orderBy(asc(users.email)) : [];
  return <AdminShell title="Users and roles" description="New Entra tenant users start as viewers"><UserRoleManager initial={rows} /></AdminShell>;
}
