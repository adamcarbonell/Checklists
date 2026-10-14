// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TemplateContext, WorkspaceStep } from "@/lib/workspace-types";
import { TemplateValidationPanel } from "./template-validation-panel";

const steps: WorkspaceStep[] = [{ id: "step", templateId: "parent", title: "Install applications", body: { type: "doc", content: [] }, kind: "global", inherited: true, position: 1, organizationId: null, anchorItemId: null, placement: null, repeatVariableId: "apps", version: 1 }];
const context: TemplateContext = {
  organizationId: "org", templateVersion: 1, parentVersion: 1, valid: false, steps: [],
  variables: [{ id: "apps", key: "org.applications", label: "Applications", cardinality: "list", fieldAliases: ["name", "version"], requiredFieldAliases: ["name"], enabled: true, schemaValid: true, value: [], status: "pending", issues: ["mapping_changed_requires_sync"], syncedAt: new Date().toISOString(), used: true }],
  invalidVariables: ["org.applications"],
  issues: Array.from({ length: 59 }, () => ({ code: "missing_variable", itemId: "step", variableKey: "org.applications.version" })),
};
const callbacks = () => ({ onSync: vi.fn(), onSelectStep: vi.fn(), onInspectVariables: vi.fn() });
afterEach(cleanup);

describe("actionable template validation", () => {
  it("explains schema validation versus data refresh and suppresses derived field noise", () => {
    const actions = callbacks();
    render(<TemplateValidationPanel context={context} steps={steps} canSync busy={false} {...actions} />);
    expect(screen.getByText("Applications — pending")).toBeTruthy();
    expect(screen.getByText(/Schema validation checks the field definitions/)).toBeTruthy();
    expect(screen.queryByText(/missing_variable/)).toBeNull();
    expect(actions.onSync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh organization data" }));
    expect(actions.onSync).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Inspect variables" }));
    expect(actions.onInspectVariables).toHaveBeenCalledOnce();
  });
  it("does not expose refresh to viewers or offer a refresh for an unvalidated mapping", () => {
    const { unmount } = render(<TemplateValidationPanel context={context} steps={steps} canSync={false} busy={false} {...callbacks()} />);
    expect(screen.queryByRole("button", { name: "Refresh organization data" })).toBeNull();
    unmount();
    const invalid = structuredClone(context); invalid.variables[0].schemaValid = false;
    render(<TemplateValidationPanel context={invalid} steps={steps} canSync busy={false} {...callbacks()} />);
    expect(screen.getByText(/mapping needs schema validation/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh organization data" })).toBeNull();
  });
  it("groups real missing-field errors while preserving placement errors and navigation", () => {
    const current = structuredClone(context); current.invalidVariables = []; current.variables[0].status = "valid";
    current.issues.push({ code: "missing_anchor", itemId: "local" });
    const actions = callbacks();
    render(<TemplateValidationPanel context={current} steps={steps} canSync busy={false} {...actions} />);
    const missing = screen.getByRole("button", { name: /org.applications.version \(59 repeated records\)/ });
    expect(screen.getAllByRole("button", { name: /missing_variable/ })).toHaveLength(1);
    fireEvent.click(missing); expect(actions.onSelectStep).toHaveBeenCalledWith("step");
    expect(screen.getByRole("button", { name: /missing_anchor/ })).toBeTruthy();
  });
});
