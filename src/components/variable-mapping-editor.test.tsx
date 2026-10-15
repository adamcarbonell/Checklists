// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VariableMappingEditor } from "./variable-mapping-editor";

const definition = {
  id: "apps", key: "org.applications", label: "Applications", assetTypeId: "107505", assetTypeName: "Applications", cardinality: "list" as const,
  selectedFields: [{ sourceKey: "name", alias: "name", expectedKind: "Text" }], validationRules: { sortBy: "name" }, schemaValid: true,
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("explicit approval of additional variable fields", () => {
  it("adds only the Email preset on explicit approval and shows its three direct tokens", async () => {
    const email = {
      ...definition, id: "email", key: "org.email", label: "Email", assetTypeId: "456789", assetTypeName: "Email", cardinality: "scalar",
      selectedFields: [
        { sourceKey: "type", alias: "type", expectedKind: "Select" },
        { sourceKey: "location", alias: "service_location", expectedKind: "Select" },
        { sourceKey: "inbound-delivery", alias: "inbound_delivery_spam_filter", expectedKind: "Select" },
      ], validationRules: { exactRecords: 1, requiredFields: ["type", "service_location", "inbound_delivery_spam_filter"] },
    };
    const fetcher = vi.fn(async () => Response.json({ data: email }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    render(<VariableMappingEditor initial={[definition]} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add Email variable" }));
    await screen.findByText(/Email added and schema validated/);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/variables/presets/email", { method: "POST" });
    expect(screen.queryByRole("button", { name: "Add Email variable" })).toBeNull();
    expect(screen.getByText("{{org.email.type}}")).toBeTruthy();
    expect(screen.getByText("{{org.email.service_location}}")).toBeTruthy();
    expect(screen.getByText("{{org.email.inbound_delivery_spam_filter}}")).toBeTruthy();
    expect(screen.getByLabelText("IT Glue field key 1 for Applications")).toBeTruthy();
    expect(screen.queryByText("{{org.email.domains}}")).toBeNull();
  });
  it("does not offer to replace an existing Email mapping", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<VariableMappingEditor initial={[{ ...definition, key: "org.email", label: "Email" }]} />);
    expect(screen.queryByRole("button", { name: "Add Email variable" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains existing mappings and shows a safe error when Email discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "private-error-payload" }, { status: 502 })));
    render(<VariableMappingEditor initial={[definition]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Email variable" }));
    await screen.findByText(/Could not safely identify all three Email fields/);
    expect(screen.getByLabelText("IT Glue field key 1 for Applications")).toBeTruthy();
    expect(screen.queryByText(/private-error-payload/)).toBeNull();
    expect((screen.getByRole("button", { name: "Add Email variable" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("stages multiple fields without requesting data, saves exact aliases, and requires review then sync", async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(options.method).toBe(url.endsWith("/validate") ? "POST" : "PATCH");
      return Response.json({ data: url.endsWith("/validate") ? { schemaValid: true, issues: [] } : { schemaValid: false } });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<VariableMappingEditor initial={[definition]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add approved field" }));
    fireEvent.change(screen.getByLabelText("IT Glue field key 2 for Applications"), { target: { value: "application-version" } });
    fireEvent.change(screen.getByLabelText("Token alias 2 for Applications"), { target: { value: "version" } });
    expect(screen.getByText("{{org.applications.version}}")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Validate schema" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await screen.findByText(/Saved\. Validate schema/);
    expect(fetcher).toHaveBeenCalledWith("/api/variables?id=apps", expect.objectContaining({ method: "PATCH" }));
    const options = fetcher.mock.calls[0][1] as { body: string };
    expect(JSON.parse(options.body).selectedFields).toEqual([
      definition.selectedFields[0], { sourceKey: "application-version", alias: "version", expectedKind: "Text" },
    ]);
    expect(screen.getByText("Needs review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate schema" }));
    await screen.findByText(/Schema validated\. Sync the organization/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("/api/variables/apps/validate", { method: "POST" });
  });
  it("renders and edits every existing field and only removes a row from the draft", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<VariableMappingEditor initial={[{ ...definition, selectedFields: [...definition.selectedFields, { sourceKey: "version", alias: "version", expectedKind: "Text" }] }]} />);
    fireEvent.change(screen.getByLabelText("Token alias 2 for Applications"), { target: { value: "app_version" } });
    expect(screen.getByText("{{org.applications.app_version}}")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove approved field 2 for Applications" }));
    expect(screen.queryByText("{{org.applications.app_version}}")).toBeNull();
    expect((screen.getByRole("button", { name: "Remove approved field 1 for Applications" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains draft fields and shows a safe error if saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "internal detail must not be displayed" }, { status: 400 })));
    render(<VariableMappingEditor initial={[definition]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add approved field" }));
    fireEvent.change(screen.getByLabelText("Token alias 2 for Applications"), { target: { value: "version" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Save could not be confirmed"));
    expect((screen.getByLabelText("Token alias 2 for Applications") as HTMLInputElement).value).toBe("version");
    expect(screen.queryByText(/internal detail/)).toBeNull();
  });
});
