import { isDeepStrictEqual } from "node:util";
import type { variableDefinitions } from "@/db/schema";

type VariableMapping = Pick<
  typeof variableDefinitions.$inferSelect,
  "selectedFields" | "assetTypeId" | "cardinality" | "key" | "validationRules"
>;
const mappingKeys = [
  "selectedFields", "assetTypeId", "cardinality", "key", "validationRules",
] as const;

export function hasMappingChanges(
  current: VariableMapping,
  patch: Partial<VariableMapping>,
) {
  return mappingKeys.some(
    (key) => Object.hasOwn(patch, key) && !isDeepStrictEqual(current[key], patch[key]),
  );
}
