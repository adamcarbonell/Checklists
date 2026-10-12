import { readMigrationFiles } from "drizzle-orm/migrator";
import { closeDatabase, getDatabase } from "../src/db/client";
import { MigrationConfirmationError } from "../src/lib/migration-guard";
import { applyMigrations } from "../src/lib/migration-runner";

async function main() {
  await applyMigrations(
    getDatabase(),
    readMigrationFiles({ migrationsFolder: "drizzle" }),
    process.argv,
  );
  console.log("Database migrations completed.");
}

main()
  .then(closeDatabase)
  .catch(async (error) => {
    console.error(
      error instanceof MigrationConfirmationError
        ? error.message
        : "Migration failed. No error payload or credentials have been logged.",
    );
    await closeDatabase();
    process.exitCode = 1;
  });
