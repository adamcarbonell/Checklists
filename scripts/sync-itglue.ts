import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/db/client";
import { organizations } from "../src/db/schema";
import { syncOrganization } from "../src/lib/sync-service";

async function main() {
  const enabled = await getDatabase()
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(eq(organizations.enabled, true), isNull(organizations.deletedAt)),
    )
    .limit(1000);
  let failed = 0;
  for (const organization of enabled) {
    try {
      await syncOrganization(organization.id, "cron");
    } catch {
      failed += 1;
      console.error(`Sync failed for organization ${organization.id}.`);
    }
  }
  console.log(
    `IT Glue sync complete: ${enabled.length - failed} succeeded, ${failed} failed.`,
  );
  if (failed) process.exitCode = 1;
}

main()
  .then(closeDatabase)
  .catch(async () => {
    console.error(
      "Sync command failed. No error payload or credentials have been logged.",
    );
    await closeDatabase();
    process.exitCode = 1;
  });
