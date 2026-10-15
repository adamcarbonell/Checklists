import { describe, expect, it, vi } from "vitest";
import { discoverEmailVariable } from "./email-variable";
import { ItGlueClient, ItGlueLimitError, ItGlueMalformedError } from "./itglue";
import { resolveVariable } from "./variable-validation";
import { renderTemplate } from "./template-engine";

const schema = {
  id: "456789", name: "Email",
  fields: [
    { key: "email-platform", name: "Type", kind: "Select" },
    { key: "hosting-location", name: "Service Location", kind: "Select" },
    { key: "inbound-delivery", name: "Inbound Delivery - Spam Filter", kind: "Select" },
    { key: "domains", name: "Domain(s)", kind: "Tag" },
    { key: "credentials", name: "Password", kind: "Password" },
  ],
};
function clientFor(value = schema, names = ["Email"]) {
  return {
    lookupFlexibleAssetTypes: vi.fn(async (name: string) => names.includes(name) ? [{ id: value.id, name }] : []),
    getFlexibleAssetType: vi.fn(async () => value),
  };
}

describe("single-record Email variable", () => {
  it("discovers the tenant's exact ID, field keys and kinds and approves only the requested fields", async () => {
    const client = clientFor();
    const definition = await discoverEmailVariable(client);
    expect(client.lookupFlexibleAssetTypes.mock.calls).toEqual([["Email"], ["Emails"]]);
    expect(client.getFlexibleAssetType).toHaveBeenCalledWith("456789");
    expect(definition).toEqual({
      key: "org.email", label: "Email", assetTypeId: "456789", assetTypeName: "Email", cardinality: "scalar",
      selectedFields: [
        { sourceKey: "email-platform", alias: "type", expectedKind: "Select" },
        { sourceKey: "hosting-location", alias: "service_location", expectedKind: "Select" },
        { sourceKey: "inbound-delivery", alias: "inbound_delivery_spam_filter", expectedKind: "Select" },
      ],
      validationRules: { exactRecords: 1, requiredFields: ["type", "service_location", "inbound_delivery_spam_filter"] },
    });
    expect(JSON.stringify(definition)).not.toMatch(/domains|credentials|Password/);
  });
  it("accepts the plural type name and standard Location/Inbound Delivery labels", async () => {
    const value = { ...schema, name: "Emails", fields: schema.fields.map((field) => ({ ...field, name: field.name === "Service Location" ? "Location" : field.name === "Inbound Delivery - Spam Filter" ? "Inbound Delivery" : field.name })) };
    expect((await discoverEmailVariable(clientFor(value, ["Emails"]))).assetTypeName).toBe("Emails");
  });
  it("does not guess when the type is missing or ambiguous", async () => {
    const missing = clientFor(schema, []);
    await expect(discoverEmailVariable(missing)).rejects.toThrow("email_asset_type_not_found");
    expect(missing.getFlexibleAssetType).not.toHaveBeenCalled();
    const ambiguous = clientFor();
    ambiguous.lookupFlexibleAssetTypes.mockImplementation(async (name) => [{ id: name === "Email" ? "1" : "2", name }]);
    await expect(discoverEmailVariable(ambiguous)).rejects.toThrow("email_asset_type_ambiguous");
    expect(ambiguous.getFlexibleAssetType).not.toHaveBeenCalled();
  });
  it.each(["Password", "Upload", "Tag", "Number"])("refuses an incompatible %s field", async (kind) => {
    const value = { ...schema, fields: schema.fields.map((field, index) => index === 0 ? { ...field, kind } : field) };
    await expect(discoverEmailVariable(clientFor(value))).rejects.toThrow("email_field_unsupported:type");
  });
  it("rejects a missing field, duplicate field label, or a renamed type during discovery", async () => {
    await expect(discoverEmailVariable(clientFor({ ...schema, fields: schema.fields.slice(1) }))).rejects.toThrow("email_field_missing:type");
    await expect(discoverEmailVariable(clientFor({ ...schema, fields: [...schema.fields, { ...schema.fields[0], key: "other" }] }))).rejects.toThrow("email_field_ambiguous:type");
    const changed = clientFor();
    changed.getFlexibleAssetType.mockResolvedValue({ ...schema, name: "Other" });
    await expect(discoverEmailVariable(changed)).rejects.toThrow("email_schema_changed_retry");
  });
  it("projects only the approved Email values and renders them without repetition", async () => {
    const definition = await discoverEmailVariable(clientFor());
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher: async () => Response.json({ data: [{ id: "1", attributes: { archived: false, name: "Office 365", traits: {
      "email-platform": "Office 365", "hosting-location": "Cloud", "inbound-delivery": "Inky", domains: "discard-domains", credentials: "discard-secret",
    } } }] }) });
    const assets = await client.getFlexibleAssets({ organizationId: "20", assetTypeId: definition.assetTypeId, selectedFields: definition.selectedFields });
    const resolution = resolveVariable(definition, assets);
    expect(resolution).toMatchObject({ status: "valid", value: { type: "Office 365", service_location: "Cloud", inbound_delivery_spam_filter: "Inky" } });
    expect(JSON.stringify(assets)).not.toMatch(/discard-domains|discard-secret|credentials|domains/);
    const rendered = renderTemplate([{ id: "step", kind: "global", position: 100, title: "Configure {{org.email.type}}", body: { type: "doc", content: [{ type: "text", text: "{{org.email.service_location}} / {{org.email.inbound_delivery_spam_filter}}" }] } }], "20", { org: { email: resolution.value } });
    expect(rendered.valid).toBe(true);
    expect(rendered.steps).toHaveLength(1);
    expect(rendered.steps[0]).toMatchObject({ title: "Configure Office 365", body: { content: [{ text: "Cloud / Inky" }] } });
    expect(resolveVariable(definition, []).status).toBe("invalid");
    expect(resolveVariable(definition, [...assets, ...assets]).status).toBe("invalid");
    expect(resolveVariable(definition, [{ ...assets[0], fields: { ...assets[0].fields, type: " " } }]).issues).toContain("record_1_missing_type");
  });
});

describe("narrow asset type lookup", () => {
  it("previews the exact-name query before fetching and discards other metadata and nonmatching types", async () => {
    const preview = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      expect(preview).toHaveBeenCalledOnce();
      expect(new URL(String(url)).searchParams.get("filter[name]")).toBe("Email");
      expect(new URL(String(url)).searchParams.get("page[size]")).toBe("25");
      return Response.json({ data: [{ id: "10", attributes: { name: "Email", description: "discard-me" } }, { id: "11", attributes: { name: "Email Archive" } }] });
    });
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: preview, fetcher });
    expect(await client.lookupFlexibleAssetTypes("Email")).toEqual([{ id: "10", name: "Email" }]);
    expect(preview).toHaveBeenCalledWith({ method: "GET", endpoint: "/flexible_asset_types", filters: { name: "Email" }, projectedFields: ["id", "name"], resultLimit: 25, dataSensitivity: "tenant-schema", possibleSideEffects: "none-read-only" });
  });
  it.each([
    { data: {}, },
    { data: [{ id: "bad", attributes: { name: "Email" } }] },
    { data: [], meta: { "total-count": "bad" } },
  ])("rejects malformed type responses", async (payload) => {
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher: async () => Response.json(payload) });
    await expect(client.lookupFlexibleAssetTypes("Email")).rejects.toBeInstanceOf(ItGlueMalformedError);
  });
  it.each([
    { data: [], meta: { "total-count": 26 } },
    { data: [], links: { next: "do-not-follow" } },
    { data: Array.from({ length: 26 }, (_, index) => ({ id: String(index), attributes: { name: "Email" } })) },
  ])("rejects paginated/oversized responses instead of broadening or truncating", async (payload) => {
    const fetcher = vi.fn(async () => Response.json(payload));
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher });
    await expect(client.lookupFlexibleAssetTypes("Email")).rejects.toBeInstanceOf(ItGlueLimitError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
