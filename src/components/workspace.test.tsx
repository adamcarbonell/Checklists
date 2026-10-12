// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkspaceData, TemplateContext } from "@/lib/workspace-types";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("next-auth/react", () => ({ signOut: mocks.signOut }));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    ref: () => {},
    handleRef: () => {},
    isDragSource: false,
    isDropTarget: false,
  }),
}));
vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    editable,
    onInsertVariable,
  }: {
    value: { content?: { content?: { text?: string }[] }[] };
    onChange: (v: unknown) => void;
    editable: boolean;
    onInsertVariable: () => void;
  }) => (
    <>
      <textarea
        aria-label="Instructions"
        disabled={!editable}
        value={value.content?.[0]?.content?.[0]?.text ?? ""}
        onChange={(e) =>
          onChange({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: e.target.value }],
              },
            ],
          })
        }
      />
      {editable && <button onClick={onInsertVariable}>Variable</button>}
    </>
  ),
}));
import { ChecklistWorkspace } from "./checklist-workspace";
import { GlobalLibrary } from "./global-library";
const user = {
  name: "Test Editor",
  email: "editor@example.test",
  role: "editor" as const,
};
const data: WorkspaceData = {
  templateId: "template-1",
  templateName: "Test template",
  templateDescription: "Example",
  globalCount: 2,
  organizations: [
    { id: "org-1", name: "Organization One" },
    { id: "org-2", name: "Organization Two" },
  ],
  templates: [{ id: "template-1", name: "Test template" }],
  definitions: [
    {
      id: "list-1",
      key: "org.applications",
      label: "Applications",
      cardinality: "list",
      schemaValid: true,
      enabled: true,
    },
  ],
  steps: [
    {
      id: "one",
      sourceId: "source-one",
      kind: "global",
      title: "First step",
      body: { type: "doc" },
      position: 100,
      organizationId: null,
      anchorItemId: null,
      placement: null,
      repeatVariableId: null,
    },
    {
      id: "two",
      sourceId: "source-two",
      kind: "global",
      title: "Second step",
      body: { type: "doc" },
      position: 200,
      organizationId: null,
      anchorItemId: null,
      placement: null,
      repeatVariableId: null,
    },
    {
      id: "snapshot",
      sourceId: "org-source",
      kind: "org",
      title: "Org One snapshot",
      body: { type: "doc" },
      position: 100,
      organizationId: "org-1",
      anchorItemId: "one",
      placement: "after",
      repeatVariableId: null,
    },
  ],
};
const context: TemplateContext = {
  organizationId: "org-1",
  variables: [
    {
      ...data.definitions[0],
      value: [{ name: "Example app" }],
      status: "valid",
      issues: [],
      syncedAt: new Date().toISOString(),
      used: true,
    },
  ],
  issues: [],
  invalidVariables: [],
  valid: true,
  steps: [],
};
let requests: {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}[];
beforeEach(() => {
  requests = [];
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string, options: { method?: string; body?: string } = {}) => {
        requests.push({
          url,
          method: options.method ?? "GET",
          body: options.body ? JSON.parse(options.body) : null,
        });
        return new Response(
          JSON.stringify({
            data:
              url === "/api/templates" && options.method === "POST"
                ? { id: "created-template" }
                : url.includes("context?")
                  ? context
                  : url.includes("workspace")
                    ? data
                    : [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("workspace controls", () => {
  it("creates templates using an in-page form without browser prompt support", async () => {
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("prompt unavailable");
    });
    try {
      render(<ChecklistWorkspace initialData={data} user={user} />);
      fireEvent.click(screen.getByRole("button", { name: "New template" }));
      expect(
        await screen.findByRole("dialog", { name: "New template" }),
      ).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Create template",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(requests.some((request) => request.method === "POST")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "New template" }));
      fireEvent.change(screen.getByLabelText("Template name"), {
        target: { value: "New checklist" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create template" }));
      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith(
          "/?templateId=created-template",
        ),
      );
      expect(
        requests.find((request) => request.url === "/api/templates")?.body,
      ).toEqual({ name: "New checklist" });
      expect(prompt).not.toHaveBeenCalled();
    } finally {
      prompt.mockRestore();
    }
  });
  it("inserts variable tokens from an in-page form and saves the step", async () => {
    render(<ChecklistWorkspace initialData={data} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Variable" }));
    expect(
      await screen.findByRole("dialog", { name: "Insert variable" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert variable" }));
    await waitFor(
      () =>
        expect(requests.some((request) => request.method === "PATCH")).toBe(
          true,
        ),
      { timeout: 2000 },
    );
    expect(
      JSON.stringify(
        requests.find((request) => request.method === "PATCH")?.body,
      ),
    ).toContain("{{org.applications}}");
  });
  it("switches diagnostic tabs and organization-specific snapshots", async () => {
    render(<ChecklistWorkspace initialData={data} user={user} />);
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes("context?"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Variables" }));
    expect(
      await screen.findByText("Example app", { exact: false }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
    expect(await screen.findByText("Ready to preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Preview organization" }),
      { target: { value: "org-2" } },
    );
    expect(
      screen.queryByRole("button", { name: /Org One snapshot/ }),
    ).toBeNull();
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes("organizationId=org-2"))).toBe(
        true,
      ),
    );
  });
  it("saves repetition and both step drafts across rapid selection changes", async () => {
    render(<ChecklistWorkspace initialData={data} user={user} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Repeat for a list variable" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Repeat list variable" }),
      { target: { value: "list-1" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Step title" }), {
      target: { value: "Edited first" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Second step/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Step title" }), {
      target: { value: "Edited second" },
    });
    await waitFor(
      () =>
        expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2),
      { timeout: 2000 },
    );
    expect(
      requests.find((r) => r.url === "/api/global-steps/source-one")?.body,
    ).toMatchObject({ title: "Edited first", repeatVariableId: "list-1" });
    expect(
      requests.find((r) => r.url === "/api/global-steps/source-two")?.body,
    ).toMatchObject({ title: "Edited second" });
  });
  it("opens core menus, edits template details, and exposes sign-out", async () => {
    render(<ChecklistWorkspace initialData={data} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Template actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Edit template details" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit template details",
    });
    expect(dialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.body?.name === "Renamed",
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() =>
      expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/" }),
    );
  });
  it("makes viewers read-only while retaining inspection and navigation", () => {
    render(
      <ChecklistWorkspace
        initialData={data}
        user={{ ...user, role: "viewer" }}
      />,
    );
    expect(
      (screen.getByRole("textbox", { name: "Step title" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("checkbox", { name: "Repeat for a list variable" })
        .matches(":disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Add a step" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Global library/ }).getAttribute("href"),
    ).toBe("/global-library");
    fireEvent.click(screen.getByRole("button", { name: "Step 1 actions" }));
    expect(
      (screen.getByRole("menuitem", { name: "Move down" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("searches library steps, links references, and protects referenced deletion", () => {
    render(
      <GlobalLibrary
        initialSteps={[
          {
            id: "source-one",
            title: "Shared instructions",
            body: { type: "doc" },
            repeatVariableId: null,
            references: [{ id: "template-1", name: "Test template" }],
          },
        ]}
        definitions={data.definitions}
        user={user}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Test template" }).getAttribute("href"),
    ).toBe("/?templateId=template-1");
    fireEvent.click(
      screen.getByRole("button", { name: "Global step actions" }),
    );
    expect(
      (
        screen.getByRole("menuitem", {
          name: /Delete unavailable/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search global steps" }),
      { target: { value: "absent" } },
    );
    expect(screen.getByText("No matching active steps.")).toBeTruthy();
  });
});
