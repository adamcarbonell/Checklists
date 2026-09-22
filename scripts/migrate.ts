import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { closeDatabase, getDatabase } from "../src/db/client";

async function main() {
  const db = getDatabase();
  // Northflank's standard PostgreSQL role can create tables in public, but cannot
  // run Drizzle's unconditional CREATE SCHEMA statement, even for public itself.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
    id serial PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  const latest = await db.execute<{ created_at: string | number | null }>(
    sql`SELECT created_at FROM public.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  const lastAppliedAt = Number(latest[0]?.created_at ?? 0);
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  await db.transaction(async (tx) => {
    for (const migration of migrations) {
      if (migration.folderMillis <= lastAppliedAt) continue;
      for (const statement of migration.sql) await tx.execute(sql.raw(statement));
      await tx.execute(sql`INSERT INTO public.__drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
  });
  console.log("Database migrations completed.");
}

main().then(closeDatabase).catch(async (error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
  await closeDatabase();
  process.exitCode = 1;
});
