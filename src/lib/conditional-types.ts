export type Comparison = {
  variableKey: string;
  operator: "equals" | "not_equals";
  value: string | number | boolean;
};
export type TemplateBranch = {
  id: string;
  groupItemId: string;
  position: number;
  condition: Comparison | null;
  inherited?: boolean;
  deleted?: boolean;
};
export type ConditionField = {
  key: string;
  definitionKey: string;
  kind: "text" | "number" | "boolean";
  label: string;
};
export type ConditionDecision = {
  groupId: string;
  status: "selected" | "blocked" | "not_reached";
  selectedBranchId: string | null;
  evaluated: { branchId: string; condition: Comparison | null; result: boolean | "invalid" }[];
};

export function conditionKind(kind: string): ConditionField["kind"] | null {
  const value = kind.toLowerCase();
  if (["text", "textbox", "textarea", "url", "email", "date", "select"].includes(value)) return "text";
  if (["number", "integer", "float"].includes(value)) return "number";
  if (["checkbox", "boolean"].includes(value)) return "boolean";
  return null;
}

export function conditionFields(definitions: {
  key: string; label: string; cardinality: string; enabled: boolean;
  fieldAliases: string[]; fieldKinds?: Record<string, string>;
}[]): ConditionField[] {
  return definitions.filter((definition) => definition.enabled && definition.cardinality === "scalar")
    .flatMap((definition) => definition.fieldAliases.flatMap((alias) => {
      const kind = conditionKind(definition.fieldKinds?.[alias] ?? "Text");
      return kind ? [{
        key: definition.fieldAliases.length === 1 ? definition.key : `${definition.key}.${alias}`,
        definitionKey: definition.key, kind,
        label: definition.fieldAliases.length === 1 ? definition.label : `${definition.label}: ${alias}`,
      }] : [];
    }));
}
