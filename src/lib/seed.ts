import type { Database } from "@/db/client";
import { variableDefinitions } from "@/db/schema";
export async function seedVariableDefinitions(db: Database) {
  await db
    .insert(variableDefinitions)
    .values([
      {
        key: "org.ad_full_name",
        label: "AD Full Name",
        assetTypeId: "107504",
        assetTypeName: "Active Directory",
        cardinality: "scalar",
        selectedFields: [
          { sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" },
        ],
        validationRules: { exactRecords: 1, requiredFields: ["value"] },
      },
      {
        key: "org.applications",
        label: "Applications",
        assetTypeId: "107505",
        assetTypeName: "Applications",
        cardinality: "list",
        selectedFields: [
          { sourceKey: "name", alias: "name", expectedKind: "Text" },
        ],
        validationRules: {
          minItems: 0,
          sortBy: "name",
          requiredFields: ["name"],
        },
      },
    ])
    .onConflictDoNothing({ target: variableDefinitions.key });
}
