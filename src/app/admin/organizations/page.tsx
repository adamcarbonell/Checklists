import { redirect } from "next/navigation";
import { asc, isNull } from "drizzle-orm";
import { AdminShell } from "@/components/admin-shell";
import { OrganizationManager } from "@/components/organization-manager";
import { getDatabase, hasDatabase } from "@/db/client";
import { organizations } from "@/db/schema";
import { currentUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export default async function OrganizationsPage() {
  const user = await currentUser(); if (!user) redirect("/api/auth/signin?callbackUrl=/admin/organizations"); if (user.role !== "admin") redirect("/");
  const rows = hasDatabase() ? await getDatabase().select().from(organizations).where(isNull(organizations.deletedAt)).orderBy(asc(organizations.name)) : [];
  return <AdminShell title="Organizations" description="Enable tenants and validate their read-only IT Glue context"><OrganizationManager initial={rows} /></AdminShell>;
}
