import { desc, sql } from "drizzle-orm";
import { bigint, pgTable, serial, text } from "drizzle-orm/pg-core";
import type { MigrationMeta } from "drizzle-orm/migrator";
import type { Database } from "@/db/client";
import { requireMigrationConfirmation } from "./migration-guard";

const journal = pgTable("__drizzle_migrations", {
  id: serial("id").primaryKey(),
  hash: text("hash").notNull(),
  createdAt: bigint("created_at", { mode: "number" }),
});

export async function applyMigrations(
  db: Database,
  migrations: MigrationMeta[],
  args: string[],
) {
  // Northflank's standard role can create tables in public, but not schemas.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
    id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
  )`);
  return db.transaction(async (tx) => {
    // Serialize migration runners; re-read the journal only after taking the lock.
    await tx.execute(
      sql`LOCK TABLE public.__drizzle_migrations IN EXCLUSIVE MODE`,
    );
    const [latest] = await tx
      .select({ createdAt: journal.createdAt })
      .from(journal)
      .orderBy(desc(journal.createdAt))
      .limit(1);
    const pending = migrations.filter(
      (migration) => migration.folderMillis > (latest?.createdAt ?? 0),
    );
    for (const migration of pending)
      requireMigrationConfirmation(migration.sql, args);
    for (const migration of pending) {
      for (const statement of migration.sql)
        await tx.execute(sql.raw(statement));
      await tx
        .insert(journal)
        .values({ hash: migration.hash, createdAt: migration.folderMillis });
    }
    return pending.length;
  });
}
