import { sql } from "drizzle-orm";
import { getDatabase, hasDatabase } from "@/db/client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!hasDatabase())
    return Response.json(
      { status: "not_ready", reason: "database_not_configured" },
      { status: 503 },
    );
  try {
    // The new web image must not receive traffic before its schema exists.
    await getDatabase()
      .execute(sql`select t.scope, t.version, c.variable_snapshot, s.version
      from templates t cross join checklists c cross join checklist_steps s limit 0`);
    return Response.json({ status: "ready" });
  } catch {
    return Response.json(
      { status: "not_ready", reason: "database_or_schema_unavailable" },
      { status: 503 },
    );
  }
}
