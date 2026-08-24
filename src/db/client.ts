import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var checklistSql: ReturnType<typeof postgres> | undefined;
  var checklistDb: Database | undefined;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabase(): Database {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for persistent operations.");
  if (!globalThis.checklistSql) globalThis.checklistSql = postgres(process.env.DATABASE_URL, { max: 8, idle_timeout: 20, prepare: false });
  if (!globalThis.checklistDb) globalThis.checklistDb = drizzle(globalThis.checklistSql, { schema });
  return globalThis.checklistDb;
}

export async function closeDatabase() {
  if (globalThis.checklistSql) await globalThis.checklistSql.end();
  globalThis.checklistSql = undefined;
  globalThis.checklistDb = undefined;
}
