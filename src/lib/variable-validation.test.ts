import { describe, expect, it } from "vitest";
import { resolveVariable, type ProjectedAsset } from "./variable-validation";

const ad = { key: "org.ad_full_name", cardinality: "scalar" as const, selectedFields: [{ sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" }], validationRules: { exactRecords: 1, requiredFields: ["value"] } };

describe("variable validation", () => {
  it("requires one non-empty AD record", () => {
    expect(resolveVariable(ad, []).status).toBe("invalid");
    expect(resolveVariable(ad, [{ id: "1", name: "AD", fields: { value: "" } }]).issues).toContain("record_1_missing_value");
    expect(resolveVariable(ad, [{ id: "1", name: "A", fields: { value: "a" } }, { id: "2", name: "B", fields: { value: "b" } }]).status).toBe("invalid");
  });

  it("returns the scalar value and sorts application records", () => {
    expect(resolveVariable(ad, [{ id: "1", name: "AD", fields: { value: "acme.local" } }]).value).toBe("acme.local");
    const assets: ProjectedAsset[] = [{ id: "2", name: "Z", fields: { name: "Zoom" } }, { id: "1", name: "A", fields: { name: "Adobe" } }];
    const result = resolveVariable({ key: "org.applications", cardinality: "list", selectedFields: [{ sourceKey: "name", alias: "name", expectedKind: "Text" }], validationRules: { sortBy: "name" } }, assets);
    expect(result.value).toEqual([{ id: "1", name: "Adobe" }, { id: "2", name: "Zoom" }]);
  });

  it("rejects schema drift", () => {
    const result = resolveVariable(ad, [{ id: "1", name: "AD", fields: { value: 42 } }]);
    expect(result.issues).toContain("record_1_schema_mismatch_value");
  });
});
