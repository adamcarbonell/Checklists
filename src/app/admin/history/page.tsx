import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AdminShell } from "@/components/admin-shell";
import { getDatabase, hasDatabase } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { currentUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export default async function HistoryPage() {
  const user = await currentUser(); if (!user) redirect("/api/auth/signin?callbackUrl=/admin/history"); if (user.role !== "admin") redirect("/");
  const events = hasDatabase() ? await getDatabase().select({ id: auditEvents.id, eventType: auditEvents.eventType, entityType: auditEvents.entityType, entityId: auditEvents.entityId, createdAt: auditEvents.createdAt }).from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(200) : [];
  return <AdminShell title="Audit history" description="Sanitized changes and IT Glue request previews"><section className="overflow-hidden rounded-2xl border border-[#d9e2dc] bg-white">{events.map((event) => <div key={event.id} className="grid gap-2 border-b border-[#edf1ee] px-5 py-4 last:border-0 md:grid-cols-[220px_minmax(0,1fr)_190px]"><code className="text-xs font-semibold text-teal-800">{event.eventType}</code><div className="text-xs text-slate-600">{event.entityType ?? "system"}{event.entityId ? ` · ${event.entityId}` : ""}</div><time className="text-[11px] text-slate-400">{event.createdAt.toLocaleString()}</time></div>)}</section></AdminShell>;
}
