import { sql } from "drizzle-orm";
import { getDatabase, hasDatabase } from "@/db/client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!hasDatabase()) return Response.json({ status: "not_ready", reason: "database_not_configured" }, { status: 503 });
  try { await getDatabase().execute(sql`select 1`); return Response.json({ status: "ready" }); }
  catch { return Response.json({ status: "not_ready", reason: "database_unavailable" }, { status: 503 }); }
}
