import { closeDatabase, getDatabase } from "../src/db/client";
import { seedVariableDefinitions } from "../src/lib/seed";
async function main() {
  await seedVariableDefinitions(getDatabase());
  console.log(
    "Missing variable definitions are ready. Existing approved mappings were preserved; no sample templates were created.",
  );
}
main()
  .then(closeDatabase)
  .catch(async () => {
    console.error(
      "Seed failed. No error payload or credentials have been logged.",
    );
    await closeDatabase();
    process.exitCode = 1;
  });
