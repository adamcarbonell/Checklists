import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, getDatabase } from "../src/db/client";

async function main() {
  await migrate(getDatabase(), { migrationsFolder: "drizzle", migrationsSchema: "public" });
  console.log("Database migrations completed.");
}

main().then(closeDatabase).catch(async (error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
  await closeDatabase();
  process.exitCode = 1;
});
