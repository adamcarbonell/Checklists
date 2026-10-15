// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  WorkspaceData,
  ChecklistDetail,
  TemplateSummary,
  TemplateContext,
} from "@/lib/workspace-types";
const mocks = vi.hoisted(() => ({ push: vi.fn(), signOut: vi.fn(), dragEnd: undefined as undefined | ((event: unknown) => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({ signOut: mocks.signOut }));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: unknown) => void }) => { mocks.dragEnd=onDragEnd; return children; },
  useDraggable: () => ({ ref: () => {}, handleRef: () => {}, isDragSource: false }),
  useDroppable: () => ({ ref: () => {}, isDropTarget: false }),
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    ref: () => {},
    handleRef: () => {},
    isDragSource: false,
    isDropTarget: false,
  }),
  isSortable: () => false,
}));
vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    editable,
    onInsertVariable,
  }: {
    value: { content?: { content?: { text?: string }[] }[] };
    onChange: (value: unknown) => void;
    editable: boolean;
    onInsertVariable: () => void;
  }) => (
    <>
      <textarea
        aria-label="Instructions"
        disabled={!editable}
        value={value.content?.[0]?.content?.[0]?.text ?? ""}
        onChange={(event) =>
          onChange({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: event.target.value }],
              },
            ],
          })
        }
      />
      {editable && <button onClick={onInsertVariable}>Variable</button>}
    </>
  ),
}));
import { TemplateWorkspace } from "./template-workspace";
import { TemplateCatalog, OrganizationDirectory } from "./template-catalog";
import { ChecklistBoard } from "./checklist-board";
import { ChecklistRun } from "./checklist-run";
import { stepCreateSchema } from "@/lib/input";
const user = {
    name: "Editor",
    email: "editor@example.test",
    role: "editor" as const,
  },
  viewer = { ...user, role: "viewer" as const };
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const fixture: WorkspaceData = {
  templateId: "child",
  templateName: "Client onboarding",
  templateDescription: "Client",
  scope: "organization",
  organizationId: "org-1",
  organizationName: "Client One",
  parent: { id: "parent", name: "Standard onboarding", version: 3 },
  version: 2,
  organizations: [
    { id: "org-1", name: "Client One" },
    { id: "org-2", name: "Client Two" },
  ],
  definitions: [
    {
      id: "list",
      key: "org.applications",
      label: "Applications",
      cardinality: "list",
      enabled: true,
      schemaValid: true,
      fieldAliases: ["name", "version"],
      requiredFieldAliases: ["name"],
    },
  ],
  steps: [
    {
      id: "inherited",
      templateId: "parent",
      title: "Inherited standard",
      body: doc("Standard instructions"),
      kind: "global",
      inherited: true,
      position: 100,
      organizationId: null,
      anchorItemId: null,
      placement: null,
      repeatVariableId: null,
      version: 1,
    },
    {
      id: "local",
      templateId: "child",
      title: "Local client step",
      body: doc("Only this client"),
      kind: "org",
      inherited: false,
      position: 100,
      organizationId: "org-1",
      anchorItemId: "inherited",
      placement: "after",
      repeatVariableId: null,
      version: 1,
    },
  ],
};
const parent: TemplateSummary = {
  id: "parent",
  name: "Standard onboarding",
  scope: "global",
  organizationId: null,
  globalTemplateId: null,
  version: 3,
  deletedAt: null,
};
const child: TemplateSummary = {
  id: "child",
  name: "Client onboarding",
  scope: "organization",
  organizationId: "org-1",
  globalTemplateId: "parent",
  version: 2,
  deletedAt: null,
};
const templateContext: TemplateContext = {
  organizationId: "org-1",
  variables: [
    {
      ...fixture.definitions[0],
      value: [{ name: "Approved app" }],
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
  templateVersion: 2,
  parentVersion: 3,
};
const runFixture: ChecklistDetail = {
  id: "run",
  name: "New hire",
  organizationId: "org-1",
  organizationName: "Client One",
  templateName: "Client onboarding",
  templateId: "child",
  globalTemplateId: "parent",
  templateVersion: 2,
  globalTemplateVersion: 3,
  variableSnapshot: {},
  people: { actor: "Team member" },
  status: "active",
  completed: 0,
  skipped: 0,
  total: 2,
  createdAt: new Date().toISOString(),
  completedAt: null,
  deletedAt: null,
  steps: [1, 2].map((position) => ({
    id: "step-" + position,
    sourceItemId: "source-" + position,
    repeatIndex: null,
    position,
    title: "Frozen step " + position,
    body: doc("Frozen instructions " + position),
    status: "pending",
    notes: "",
    skipReason: "",
    statusChangedBy: null,
    statusChangedAt: null,
    notesChangedBy: null,
    notesChangedAt: null,
    version: 1,
  })),
};
let workspace: WorkspaceData,
  currentContext: TemplateContext,
  run: ChecklistDetail,
  requests: {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
  }[],
  forceConflict: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  workspace = structuredClone(fixture);
  currentContext = structuredClone(templateContext);
  run = structuredClone(runFixture);
  requests = [];
  forceConflict = false;
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
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string, options: { method?: string; body?: string } = {}) => {
        const method = options.method ?? "GET",
          body = options.body ? JSON.parse(options.body) : null;
        requests.push({ url, method, body });
        let result: unknown = { data: [] };
        if (url.includes("/workspace"))
          result = { data: structuredClone(workspace) };
        else if (url.includes("/context?")) result = { data: structuredClone(currentContext) };
        else if (url === "/api/organizations/org-1/sync" && method === "POST") {
          currentContext = structuredClone(templateContext);
          result = { data: { status: "valid" } };
        }
        else if (url.endsWith("/order") && method === "PATCH") {
          workspace.steps=workspace.steps.map((row)=>({...row,...body.proposedOrder.find((entry:{itemId:string})=>entry.itemId===row.id),version:row.version+1}));
          workspace.version++;result={data:structuredClone(workspace)};
        }
        else if (url.includes("/groups/") && method === "PATCH") {
          const parts=url.split("/"), groupId=parts[5], branchId=parts[7];
          const group=workspace.steps.find((row)=>row.id===groupId)!;
          if (forceConflict) { forceConflict=false; return Response.json({error:"group_changed_reload"},{status:409}); }
          group.version++; workspace.version++;
          if(branchId) workspace.branches=workspace.branches?.map((row)=>row.id===branchId ? {...row,condition:body.condition} : row);
          else group.title=body.title ?? group.title;
          result={data:{...group,groupVersion:group.version,templateVersion:workspace.version}};
        }
        else if (url.includes("/groups") && method === "POST") {
          const group={...fixture.steps[1],id:"new-group",title:body.title,nodeType:"condition_group" as const,placement:"end" as const,anchorItemId:null,parentBranchId:body.parentBranchId,version:1};
          workspace.steps.push(group);
          workspace.branches=[...(workspace.branches ?? []),{id:"new-branch",groupItemId:group.id,position:100,condition:body.condition}];
          workspace.version++; result={data:group};
        }
        else if (url.includes("/items") && method === "PATCH") {
          const id = new URL(url, "http://local").searchParams.get("itemId")!;
          workspace.version++;
          workspace.steps = workspace.steps.map((step) =>
            step.id === id
              ? { ...step, ...body, title: body.title === undefined ? step.title : stepCreateSchema.shape.title.parse(body.title), version: step.version + 1 }
              : step,
          );
          result = {
            data: {
              ...workspace.steps.find((step) => step.id === id),
              templateVersion: workspace.version,
            },
          };
        } else if (url.includes("/items") && method === "POST") {
          const step = {
            ...fixture.steps[1],
            ...body,
            id: "new-local",
            version: 1,
            position: 200,
          };
          workspace.steps.push(step);
          workspace.version++;
          result = { data: step };
        } else if (url === "/api/templates" && method === "POST")
          result = { data: { id: "created-template" } };
        else if (url === "/api/checklists" && method === "POST")
          result = { data: { id: "created-run" } };
        else if (url.includes("/steps/") && method === "PATCH") {
          if (forceConflict) {
            forceConflict = false;
            run.steps[0] = {
              ...run.steps[0],
              notes: "Another person's notes",
              version: 2,
            };
            return Response.json(
              { error: "step_changed_reload" },
              { status: 409 },
            );
          }
          const id = url.split("/").at(-1)!;
          run.steps = run.steps.map((step) =>
            step.id === id
              ? {
                  ...step,
                  ...(body.status ? { status: body.status } : {}),
                  ...(body.notes !== undefined ? { notes: body.notes } : {}),
                  ...(body.skipReason !== undefined
                    ? { skipReason: body.skipReason }
                    : {}),
                  version: step.version + 1,
                  statusChangedBy: "actor",
                  statusChangedAt: new Date().toISOString(),
                }
              : step,
          );
          run.completed = run.steps.filter(
            (step) => step.status === "completed",
          ).length;
          run.skipped = run.steps.filter(
            (step) => step.status === "skipped",
          ).length;
          run.status =
            run.completed + run.skipped === run.total ? "completed" : "active";
          result = { data: structuredClone(run) };
        } else if (url.includes("/activity"))
          result = { data: [], page: 1, hasMore: false };
        else if (url.startsWith("/api/checklists/run"))
          result = { data: structuredClone(run) };
        else if (url.startsWith("/api/checklists?"))
          result = { data: [], total: 0, page: 1, pageSize: 50 };
        return Response.json(result);
      },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("new template authoring", () => {
  it("persists handle drops on a node without relying on sortable optimistic indices", async () => {
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    mocks.dragEnd!({ canceled:false,operation:{source:{id:"local"},target:{id:"inherited"}} });
    await waitFor(()=>expect(requests.some((row)=>row.url.endsWith("/order")&&row.method==="PATCH")).toBe(true));
    const request=requests.find((row)=>row.url.endsWith("/order")&&row.method==="PATCH")!;
    const proposed=request.body?.proposedOrder as Record<string,unknown>[];
    expect(proposed.find((row)=>row.itemId==="local")).toMatchObject({placement:"before",anchorItemId:"inherited"});
  });
  function conditionalWorkspace(inherited=false) {
    workspace.definitions.push({id:"email",key:"org.email",label:"Email",cardinality:"scalar",enabled:true,schemaValid:true,fieldAliases:["type","location"],requiredFieldAliases:[],fieldKinds:{type:"Text",location:"Text"}});
    workspace.steps.unshift({...fixture.steps[1],id:"group",title:"Email setup",nodeType:"condition_group",inherited,kind:inherited ? "global" : "org",templateId:inherited ? "parent" : "child",placement:inherited ? null : "end",anchorItemId:null});
    workspace.steps[2]={...workspace.steps[2],parentBranchId:"if",placement:"end",anchorItemId:null};
    workspace.branches=[{id:"if",groupItemId:"group",position:100,condition:{variableKey:"org.email.type",operator:"equals",value:"Office 365"}},{id:"else",groupItemId:"group",position:200,condition:null}];
    currentContext.conditionDecisions=[{groupId:"group",status:"selected",selectedBranchId:"if",evaluated:[]}];
  }
  it("persists a branch boundary drop with branch-container information", async () => {
    conditionalWorkspace(true);
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    mocks.dragEnd!({canceled:false,operation:{source:{id:"local"},target:{id:"branch:else:end"}}});
    await waitFor(()=>expect(requests.some((row)=>row.url.endsWith("/order")&&row.method==="PATCH")).toBe(true));
    const proposed=requests.find((row)=>row.url.endsWith("/order")&&row.method==="PATCH")!.body?.proposedOrder as Record<string,unknown>[];
    expect(proposed.find((row)=>row.itemId==="local")).toMatchObject({parentBranchId:"else",placement:"end",anchorItemId:null});
  });
  it("shows all branches, decision badges, and conditional rules without executable group instructions", async () => {
    conditionalWorkspace();
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    expect(await screen.findByText("Selected")).toBeTruthy();
    expect(screen.getByText("Not selected")).toBeTruthy();
    expect(screen.getByRole("textbox",{name:"Group title"})).toBeTruthy();
    expect(screen.queryByRole("textbox",{name:"Instructions"})).toBeNull();
    expect(screen.getByText("Empty branch — intentional no-op")).toBeTruthy();
  });
  it("serializes title and rule autosaves with the current group version across selection changes", async () => {
    conditionalWorkspace();
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.change(screen.getByRole("textbox",{name:"Group title"}),{target:{value:"Email setup  "}});
    fireEvent.change(screen.getByRole("textbox",{name:"Condition value"}),{target:{value:"GSuite "}});
    fireEvent.click(screen.getByRole("button",{name:/^Local client step/}));
    await waitFor(()=>expect(requests.filter((row)=>row.method==="PATCH")).toHaveLength(2),{timeout:2000});
    expect(requests.filter((row)=>row.method==="PATCH")).toMatchObject([
      {url:"/api/templates/child/groups/group",body:{title:"Email setup  ",expectedVersion:1}},
      {url:"/api/templates/child/groups/group/branches/if",body:{condition:{value:"GSuite "},expectedVersion:2}},
    ]);
  });
  it("keeps failed rule drafts and blocks navigation instead of discarding them", async () => {
    conditionalWorkspace(); forceConflict=true;
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.change(screen.getByRole("textbox",{name:"Condition value"}),{target:{value:"Unsaved input "}});
    await screen.findByText(/Your unsaved edits remain/);
    expect((screen.getByRole("textbox",{name:"Condition value"}) as HTMLInputElement).value).toBe("Unsaved input ");
    expect(screen.getByText("Save failed")).toBeTruthy();
  });
  it("lets editors add local content inside inherited branches but prevents editing their rules", async () => {
    conditionalWorkspace(true);
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    expect((screen.getByRole("textbox",{name:"Condition value"}) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button",{name:"+ Add local step"})[0]);
    await waitFor(()=>expect(requests.some((row)=>row.method==="POST")).toBe(true));
    expect(requests.find((row)=>row.method==="POST")).toMatchObject({url:"/api/templates/child/items",body:{parentBranchId:"if",placement:"end",anchorItemId:null}});
  });
  it("creates a group with a typed rule and keeps viewers read-only", async () => {
    conditionalWorkspace();
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.click(screen.getAllByRole("button",{name:"+ Add conditional group"}).at(-1)!);
    fireEvent.change(screen.getByRole("textbox",{name:"New group title"}),{target:{value:"Email choice"}});
    const values=screen.getAllByRole("textbox",{name:"Condition value"});
    fireEvent.change(values.at(-1)!,{target:{value:"Office 365"}});
    fireEvent.click(screen.getByRole("button",{name:"Create group"}));
    await waitFor(()=>expect(requests.some((row)=>row.url==="/api/templates/child/groups"&&row.method==="POST")).toBe(true));
    cleanup();
    render(<TemplateWorkspace initialData={workspace} user={viewer} />);
    expect((screen.getByRole("textbox",{name:"Group title"}) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button",{name:"+ Add conditional group"})).toBeNull();
  });
  it("keeps inherited steps read-only and exposes editable local instructions", async () => {
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    expect(
      (screen.getByRole("textbox", { name: "Step title" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Drag step 1: Inherited standard",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Local client step/ }));
    expect(
      (screen.getByRole("textbox", { name: "Step title" }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(
      screen.getByRole("combobox", { name: "Local step placement" }),
    ).toBeTruthy();
    expect(screen.getByText(/never added to a reusable library/)).toBeTruthy();
  });
  it("creates local steps only in the current template, with no library request", async () => {
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Add local step" }));
    await waitFor(() =>
      expect(requests.some((request) => request.method === "POST")).toBe(true),
    );
    expect(requests.find((request) => request.method === "POST")).toMatchObject(
      {
        url: "/api/templates/child/items",
        body: { placement: "after", anchorItemId: "inherited" },
      },
    );
    expect(
      requests.some(
        (request) =>
          request.url.includes("global-steps") ||
          request.url.includes("/organizations/"),
      ),
    ).toBe(false);
  });
  it("saves independent drafts across fast selection changes with expected versions", async () => {
    workspace = {
      ...workspace,
      templateId: "parent",
      scope: "global",
      organizationId: null,
      organizationName: null,
      parent: null,
      steps: [
        { ...fixture.steps[0], inherited: false },
        {
          ...fixture.steps[0],
          id: "second",
          title: "Second standard",
          inherited: false,
          position: 200,
        },
      ],
    };
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Step title" }), {
      target: { value: "Edited first" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Second standard/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Step title" }), {
      target: { value: "Edited second" },
    });
    await waitFor(
      () =>
        expect(
          requests.filter((request) => request.method === "PATCH"),
        ).toHaveLength(2),
      { timeout: 2500 },
    );
    expect(
      requests.find((request) => request.url.includes("itemId=inherited"))
        ?.body,
    ).toMatchObject({ title: "Edited first", expectedVersion: 1 });
    expect(
      requests.find((request) => request.url.includes("itemId=second"))?.body,
    ).toMatchObject({ title: "Edited second", expectedVersion: 1 });
  });
  it("switches variable/validation panels without syncing IT Glue", async () => {
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.click(screen.getByRole("tab", { name: "Variables" }));
    expect(await screen.findByText(/Approved app/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
    expect(await screen.findByText("Ready to create a checklist")).toBeTruthy();
    expect(requests.some((request) => request.url.includes("/sync"))).toBe(
      false,
    );
  });
  it("keeps a global step's trailing space and caret through autosave so typing can continue", async () => {
    workspace = { ...workspace, templateId: "parent", scope: "global", organizationId: null, organizationName: null, parent: null, steps: [{ ...fixture.steps[0], inherited: false }] };
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    const title = screen.getByRole("textbox", { name: "Step title" }) as HTMLInputElement;
    title.focus();
    fireEvent.change(title, { target: { value: "O365 - " } });
    title.setSelectionRange(title.value.length, title.value.length);
    await waitFor(() => {
      expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
      expect(requests.filter((request) => request.url.endsWith("/workspace")).length).toBeGreaterThanOrEqual(2);
      expect(workspace.steps[0].title).toBe("O365 - ");
    }, { timeout: 2500 });
    expect(title.value).toBe("O365 - ");
    expect(title.selectionStart).toBe("O365 - ".length);
    fireEvent.change(title, { target: { value: title.value + "User access" } });
    await waitFor(() => expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(2), { timeout: 2500 });
    expect(workspace.steps[0].title).toBe("O365 - User access");
    expect(title.value).toBe("O365 - User access");
  });
  it("offers single-record Email field tokens without enabling repetition", async () => {
    workspace.definitions.push({ id: "email", key: "org.email", label: "Email", cardinality: "scalar", enabled: true, schemaValid: true, fieldAliases: ["type", "service_location", "inbound_delivery_spam_filter"], requiredFieldAliases: ["type", "service_location", "inbound_delivery_spam_filter"] });
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: /^Local client step/ }));
    fireEvent.click(screen.getByRole("button", { name: "Variable" }));
    expect(screen.getByRole("button", { name: "{{org.email.type}}" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "{{org.email.service_location}}" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "{{org.email.inbound_delivery_spam_filter}}" }));
    await waitFor(() => expect(requests.some((request) => request.method === "PATCH")).toBe(true), { timeout: 2500 });
    const saved = requests.find((request) => request.method === "PATCH")!;
    expect(saved.body?.repeatVariableId).toBeNull();
    expect(JSON.stringify(saved.body?.body)).toContain("{{org.email.inbound_delivery_spam_filter}}");
  });
  it("shows approved per-record tokens after selecting Applications and saves an inserted field", async () => {
    render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: /^Local client step/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat for a list variable" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Repeat list variable" }), { target: { value: "list" } });
    expect(screen.getByText("{{org.applications.name}}")).toBeTruthy();
    expect(screen.getByText("{{org.applications.version}}")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Variable" }));
    expect(screen.getByRole("region", { name: "Repeated item fields" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "{{org.applications.version}}" }));
    await waitFor(() => expect(requests.some((request) => request.method === "PATCH")).toBe(true), { timeout: 2500 });
    const saved = requests.find((request) => request.method === "PATCH")!;
    expect(saved.body?.repeatVariableId).toBe("list");
    expect(JSON.stringify(saved.body?.body)).toContain("{{org.applications.version}}");
    expect(screen.queryByRole("dialog", { name: "Insert variable" })).toBeNull();
    expect(requests.some((request) => request.url.includes("/sync"))).toBe(false);
  });
  it("explains pending mapped values without 59 duplicate errors and lets only an admin explicitly refresh them", async () => {
    currentContext.valid = false;
    currentContext.invalidVariables = ["org.applications"];
    currentContext.variables[0].status = "pending";
    currentContext.variables[0].issues = ["mapping_changed_requires_sync"];
    currentContext.issues = Array.from({ length: 59 }, () => ({ code: "missing_variable", itemId: "inherited", variableKey: "org.applications.version" }));
    render(<TemplateWorkspace initialData={workspace} user={{ ...user, role: "admin" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
    expect(await screen.findByText(/Schema validation checks the field definitions/)).toBeTruthy();
    expect(screen.queryByText(/missing_variable/)).toBeNull();
    expect(requests.some((request) => request.url.endsWith("/sync"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Refresh organization data" }));
    expect(await screen.findByText("Ready to create a checklist")).toBeTruthy();
    expect(requests.filter((request) => request.url.endsWith("/sync"))).toEqual([{ url: "/api/organizations/org-1/sync", method: "POST", body: null }]);
  });
  it("reloads stored context when returning to the tab without initiating an IT Glue sync", async () => {
    currentContext.valid = false;
    currentContext.invalidVariables = ["org.applications"];
    currentContext.variables[0].status = "pending";
    currentContext.variables[0].issues = ["mapping_changed_requires_sync"];
    render(<TemplateWorkspace initialData={workspace} user={viewer} />);
    fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
    expect(await screen.findByText(/Schema validation checks the field definitions/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh organization data" })).toBeNull();
    currentContext = structuredClone(templateContext);
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
    expect(await screen.findByText("Ready to create a checklist")).toBeTruthy();
    expect(requests.some((request) => request.url.endsWith("/sync"))).toBe(false);
  });
  it("does not offer list fields before repetition is enabled, or editing controls for viewers", () => {
    const { unmount } = render(<TemplateWorkspace initialData={workspace} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: /^Local client step/ }));
    fireEvent.click(screen.getByRole("button", { name: "Variable" }));
    expect(screen.queryByRole("region", { name: "Repeated item fields" })).toBeNull();
    expect(screen.queryByRole("button", { name: "{{org.applications}}" })).toBeNull();
    expect(screen.getByText(/select Applications first/)).toBeTruthy();
    unmount();
    workspace.steps[1].repeatVariableId = "list";
    render(<TemplateWorkspace initialData={workspace} user={viewer} />);
    fireEvent.click(screen.getByRole("button", { name: /^Local client step/ }));
    expect(screen.getByText("{{org.applications.version}}")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Variable" })).toBeNull();
  });
  it("keeps viewer template controls read-only with the new navigation", () => {
    render(<TemplateWorkspace initialData={workspace} user={viewer} />);
    expect(screen.queryByRole("button", { name: "Add local step" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Local client step/ }));
    expect(
      (screen.getByRole("textbox", { name: "Step title" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("link", { name: "Global templates" })
        .getAttribute("href"),
    ).toBe("/global-templates");
    expect(
      screen.getByRole("link", { name: "Organizations" }).getAttribute("href"),
    ).toBe("/organizations");
    expect(
      screen.getByRole("link", { name: "Checklists" }).getAttribute("href"),
    ).toBe("/");
  });
  it("creates an organization template with a fixed parent and default inherited name", async () => {
    render(
      <TemplateCatalog
        initial={[]}
        globals={[parent]}
        user={user}
        organization={{ id: "org-1", name: "Client One" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "New organization template" }),
    );
    expect(
      (screen.getByLabelText("Template name") as HTMLInputElement).value,
    ).toBe("Standard onboarding");
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/templates/created-template"),
    );
    expect(
      requests.find((request) => request.url === "/api/templates")?.body,
    ).toEqual({
      scope: "organization",
      name: "Standard onboarding",
      organizationId: "org-1",
      globalTemplateId: "parent",
    });
  });
  it("lets viewers browse organization templates without exposing admin management", () => {
    render(
      <OrganizationDirectory
        organizations={fixture.organizations}
        user={viewer}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Client One/ }).getAttribute("href"),
    ).toBe("/organizations/org-1");
    expect(
      screen.queryByRole("link", { name: "Manage IT Glue organizations" }),
    ).toBeNull();
  });
});
describe("shared runnable checklist controls", () => {
  it("lets viewers create frozen checklists using an idempotency key", async () => {
    render(
      <ChecklistBoard
        initial={{ data: [], total: 0, page: 1, pageSize: 50 }}
        organizations={fixture.organizations}
        templates={[child]}
        user={viewer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New checklist" }));
    expect(
      (screen.getByLabelText("Checklist name") as HTMLInputElement).value,
    ).toBe("Client onboarding");
    fireEvent.click(screen.getByRole("button", { name: "Create checklist" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/checklists/created-run"),
    );
    expect(
      requests.find((request) => request.method === "POST")?.body,
    ).toMatchObject({
      templateId: "child",
      name: "Client onboarding",
      creationKey: expect.any(String),
    });
  });
  it("lets viewers complete steps while instructions stay immutable", async () => {
    render(<ChecklistRun initial={run} user={viewer} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Complete step 1: Frozen step 1" }),
    );
    await waitFor(() =>
      expect(requests.some((request) => request.method === "PATCH")).toBe(true),
    );
    expect(
      requests.find((request) => request.method === "PATCH")?.body,
    ).toEqual({ status: "completed", expectedVersion: 1 });
    expect(screen.getByText("Frozen instructions 1")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Step title" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Checklist actions" }),
    ).toBeNull();
  });
  it("requires a skip reason and persists optional notes", async () => {
    render(<ChecklistRun initial={run} user={viewer} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Notes for step 1" }),
      { target: { value: "Checked with client" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[0]);
    expect(
      await screen.findByRole("dialog", { name: "Skip step" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Save skip reason",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for skipping"), {
      target: { value: "Not applicable" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save skip reason" }));
    await waitFor(() =>
      expect(requests.some((request) => request.method === "PATCH")).toBe(true),
    );
    expect(
      requests.find((request) => request.method === "PATCH")?.body,
    ).toMatchObject({
      status: "skipped",
      skipReason: "Not applicable",
      notes: "Checked with client",
      expectedVersion: 1,
    });
  });
  it("retains draft notes on conflicts and requires explicit reconciliation", async () => {
    forceConflict = true;
    render(<ChecklistRun initial={run} user={viewer} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Notes for step 1" }),
      { target: { value: "My unsaved notes" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Notes for step 1",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("My unsaved notes");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByText(/This step changed while you were editing/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use my draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PATCH"),
      ).toHaveLength(2),
    );
    expect(
      requests.filter((request) => request.method === "PATCH")[1].body,
    ).toMatchObject({ notes: "My unsaved notes", expectedVersion: 2 });
  });
  it("flushes pending notes before navigating away", async () => {
    render(<ChecklistRun initial={run} user={viewer} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Notes for step 1" }),
      { target: { value: "Do not lose this" } },
    );
    fireEvent.click(screen.getByRole("link", { name: "Global templates" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/global-templates"),
    );
    expect(
      requests.find((request) => request.method === "PATCH")?.body,
    ).toMatchObject({ notes: "Do not lose this", expectedVersion: 1 });
  });
  it("makes deleted instances read-only until administrator recovery", () => {
    render(
      <ChecklistRun
        initial={{ ...run, deletedAt: new Date().toISOString() }}
        user={{ ...user, role: "admin" }}
      />,
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Complete step 1: Frozen step 1",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/read-only until an administrator restores/),
    ).toBeTruthy();
  });
});
