import type { SelectedField } from "@/db/schema";
import type { ItGlueClient } from "./itglue";

export const EMAIL_VARIABLE_KEY = "org.email";

const requestedFields = [
  { alias: "type", labels: ["Type"] },
  { alias: "service_location", labels: ["Service Location", "Location"] },
  {
    alias: "inbound_delivery_spam_filter",
    labels: ["Inbound Delivery - Spam Filter", "Inbound Delivery"],
  },
];
const textKinds = new Set(["text", "textbox", "textarea", "select"]);
const normalizeLabel = (label: string) =>
  label.trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");

export class EmailVariableError extends Error {}

// Discover tenant-specific IDs and name-keys; never guess or request asset values.
export async function discoverEmailVariable(
  client: Pick<ItGlueClient, "lookupFlexibleAssetTypes" | "getFlexibleAssetType">,
) {
  const matches = new Map<string, { id: string; name: string }>();
  for (const name of ["Email", "Emails"])
    for (const match of await client.lookupFlexibleAssetTypes(name))
      matches.set(match.id, match);
  if (!matches.size) throw new EmailVariableError("email_asset_type_not_found");
  if (matches.size !== 1) throw new EmailVariableError("email_asset_type_ambiguous");
  const [match] = matches.values();
  const assetType = await client.getFlexibleAssetType(match.id);
  if (normalizeLabel(assetType.name) !== normalizeLabel(match.name))
    throw new EmailVariableError("email_schema_changed_retry");

  const selectedFields: SelectedField[] = requestedFields.map(({ alias, labels }) => {
    const allowedLabels = new Set(labels.map(normalizeLabel));
    const fields = assetType.fields.filter((field) => allowedLabels.has(normalizeLabel(field.name)));
    if (!fields.length) throw new EmailVariableError(`email_field_missing:${alias}`);
    if (fields.length !== 1) throw new EmailVariableError(`email_field_ambiguous:${alias}`);
    const [field] = fields;
    if (!textKinds.has(field.kind.toLowerCase()))
      throw new EmailVariableError(`email_field_unsupported:${alias}`);
    // "name" has special display-name semantics; explicitly select the trait.
    return { sourceKey: field.key === "name" ? "traits.name" : field.key, alias, expectedKind: field.kind };
  });
  if (new Set(selectedFields.map((field) => field.sourceKey)).size !== selectedFields.length)
    throw new EmailVariableError("email_schema_changed_retry");

  return {
    key: EMAIL_VARIABLE_KEY,
    label: "Email",
    assetTypeId: assetType.id,
    assetTypeName: assetType.name,
    cardinality: "scalar" as const,
    selectedFields,
    validationRules: { exactRecords: 1, requiredFields: selectedFields.map((field) => field.alias) },
  };
}
