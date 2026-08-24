import type { SelectedField, ValidationRules } from "@/db/schema";

export type ProjectedAsset = { id: string; name: string; updatedAt?: string; fields: Record<string, unknown> };
export type VariableDefinitionInput = {
  key: string;
  cardinality: "scalar" | "list";
  selectedFields: SelectedField[];
  validationRules: ValidationRules;
};

export type VariableResolution = { status: "valid" | "invalid"; value: unknown; issues: string[]; sourceUpdatedAt?: Date };

export function resolveVariable(definition: VariableDefinitionInput, assets: ProjectedAsset[]): VariableResolution {
  const issues: string[] = [];
  const rules = definition.validationRules;
  if (rules.exactRecords != null && assets.length !== rules.exactRecords) issues.push(`expected_${rules.exactRecords}_records_found_${assets.length}`);
  if (rules.minItems != null && assets.length < rules.minItems) issues.push(`minimum_${rules.minItems}_records_found_${assets.length}`);
  if (rules.maxItems != null && assets.length > rules.maxItems) issues.push(`maximum_${rules.maxItems}_records_found_${assets.length}`);

  const required = rules.requiredFields ?? [];
  for (const asset of assets) {
    for (const field of definition.selectedFields) {
      const value = asset.fields[field.alias];
      if (value != null && !matchesExpectedKind(value, field.expectedKind)) issues.push(`record_${asset.id}_schema_mismatch_${field.alias}`);
    }
    for (const field of required) {
      const value = asset.fields[field];
      if (value == null || value === "") issues.push(`record_${asset.id}_missing_${field}`);
    }
  }

  const sorted = [...assets].sort((a, b) => {
    const field = rules.sortBy;
    return field ? String(a.fields[field] ?? "").localeCompare(String(b.fields[field] ?? "")) : a.name.localeCompare(b.name);
  });
  const latest = sorted.map((asset) => asset.updatedAt).filter(Boolean).sort().at(-1);
  const scalarFields = sorted[0]?.fields ?? null;
  const value = definition.cardinality === "scalar"
    ? (scalarFields && definition.selectedFields.length === 1 ? scalarFields[definition.selectedFields[0].alias] : scalarFields)
    : sorted.map((asset) => ({ id: asset.id, ...asset.fields }));
  return { status: issues.length ? "invalid" : "valid", value, issues, sourceUpdatedAt: latest ? new Date(latest) : undefined };
}

function matchesExpectedKind(value: unknown, kind: string) {
  const normalized = kind.toLowerCase();
  if (["text", "textbox", "textarea", "url", "email", "date"].includes(normalized)) return typeof value === "string";
  if (["number", "integer", "float"].includes(normalized)) return typeof value === "number";
  if (["checkbox", "boolean"].includes(normalized)) return typeof value === "boolean";
  if (["tag", "select", "multiselect"].includes(normalized)) return Array.isArray(value) || typeof value === "string";
  return false;
}
