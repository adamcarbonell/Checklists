import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, count } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";
import { roleAllows } from "./roles";
const state = vi.hoisted(() => ({
  db: undefined as unknown as Database,
  actor: "",
  role: "admin" as "admin" | "editor" | "viewer",
  enabled: true,
}));
vi.mock("@/db/client", () => ({
  getDatabase: () => state.db,
  hasDatabase: () => true,
}));
vi.mock("@/lib/access", () => ({
  requireRole: async (minimum: "admin" | "editor" | "viewer") => {
    const [user] = await state.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, state.actor));
    if (!state.enabled || !user || user.disabled)
      return {
        ok: false,
        response: Response.json({ error: "unauthorized" }, { status: 401 }),
      };
    return roleAllows(state.role, minimum)
      ? { ok: true, user: { id: state.actor, role: state.role } }
      : {
          ok: false,
          response: Response.json({ error: "forbidden" }, { status: 403 }),
        };
  },
}));
import {
  createTemplate,
  createStep,
  changeStep,
  deleteStep,
  deleteTemplate,
} from "./template-service";
import { loadWorkspace, loadTemplateContext } from "./workspace-data";
import { saveOrder, restoreOrder } from "./order-service";
import {
  moveStep,
  visibleOrder,
  stepOrder,
  orderEntry,
} from "./template-order";
import {
  createChecklist,
  changeChecklistStep,
  loadChecklist,
  listChecklists,
  loadActivity,
  setChecklistDeleted,
} from "./checklist-service";
import {
  POST as createRunRoute,
  GET as listRunsRoute,
} from "@/app/api/checklists/route";
import { PATCH as progressRoute } from "@/app/api/checklists/[id]/steps/[stepId]/route";
import { DELETE as deleteRunRoute } from "@/app/api/checklists/[id]/route";
import { POST as restoreRunRoute } from "@/app/api/checklists/[id]/restore/route";
import { POST as templatePost } from "@/app/api/templates/route";
import {
  PATCH as templatePatch,
  DELETE as templateDelete,
} from "@/app/api/templates/[id]/route";
import {
  POST as itemPost,
  PATCH as itemPatch,
} from "@/app/api/templates/[id]/items/route";
import { PATCH as orderPatch } from "@/app/api/templates/[id]/order/route";
import { POST as restoreRevision } from "@/app/api/revisions/[id]/restore/route";
import { PATCH as mappingPatch, POST as mappingPost } from "@/app/api/variables/route";
import { POST as validateMapping } from "@/app/api/variables/[id]/validate/route";
import { POST as addEmailVariable } from "@/app/api/variables/presets/email/route";
import { POST as syncRoute } from "@/app/api/organizations/[id]/sync/route";
import { ItGlueClient } from "./itglue";
import { syncOrganization } from "./sync-service";
const client = new PGlite(),
  doc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
let globalId: string,
  childA: string,
  childB: string,
  orgA: string,
  orgB: string,
  first: string,
  repeated: string,
  localA: string,
  localB: string,
  ad: string,
  apps: string,
  otherActor: string;
const request = (
  body: unknown,
  method = "POST",
  url = "http://localhost/api",
) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
beforeAll(async () => {
  await client.exec(
    await readFile("drizzle/0000_fixed_marten_broadcloak.sql", "utf8"),
  );
  await client.exec(
    await readFile("drizzle/0001_template_execution_redesign.sql", "utf8"),
  );
  state.db = drizzle(client, { schema }) as unknown as Database;
}, 30000);
afterAll(async () => client.close());
beforeEach(async () => {
  await client.exec(
    "TRUNCATE checklist_activity, checklist_steps, checklists, template_items, templates, organization_variable_values, variable_definitions, organizations, users, revisions, audit_events, sync_runs CASCADE",
  );
  state.role = "admin";
  state.enabled = true;
  const actors = await state.db
    .insert(schema.users)
    .values([
      {
        entraSubject: "fixture-one",
        email: "one@example.test",
        name: "Editor One",
        role: "admin",
      },
      {
        entraSubject: "fixture-two",
        email: "two@example.test",
        name: "Operator Two",
        role: "viewer",
      },
    ])
    .returning();
  state.actor = actors[0].id;
  otherActor = actors[1].id;
  const orgs = await state.db
    .insert(schema.organizations)
    .values([
      { name: "Client A", itglueId: "1" },
      { name: "Client B", itglueId: "2" },
    ])
    .returning();
  orgA = orgs[0].id;
  orgB = orgs[1].id;
  const defs = await state.db
    .insert(schema.variableDefinitions)
    .values([
      {
        key: "org.ad_full_name",
        label: "AD",
        assetTypeId: "107504",
        assetTypeName: "AD",
        cardinality: "scalar",
        selectedFields: [
          { sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" },
        ],
        validationRules: { exactRecords: 1 },
      },
      {
        key: "org.applications",
        label: "Applications",
        assetTypeId: "107505",
        assetTypeName: "Applications",
        cardinality: "list",
        selectedFields: [
          { sourceKey: "name", alias: "name", expectedKind: "Text" },
        ],
        validationRules: {},
      },
    ])
    .returning();
  ad = defs[0].id;
  apps = defs[1].id;
  await state.db.insert(schema.organizationVariableValues).values(
    orgs.flatMap((org) => [
      {
        organizationId: org.id,
        definitionId: ad,
        value: org.id === orgA ? "client-a.local" : "client-b.local",
        status: "valid" as const,
        syncedAt: new Date(),
      },
      {
        organizationId: org.id,
        definitionId: apps,
        value: [
          { id: "1", name: "One", unapproved: "discard" },
          { id: "2", name: "Two" },
        ],
        status: "valid" as const,
        syncedAt: new Date(),
      },
    ]),
  );
  globalId = (
    await createTemplate({ scope: "global", name: "Onboarding" }, state.actor)
  ).id;
  childA = (
    await createTemplate(
      {
        scope: "organization",
        organizationId: orgA,
        globalTemplateId: globalId,
      },
      state.actor,
    )
  ).id;
  childB = (
    await createTemplate(
      {
        scope: "organization",
        organizationId: orgB,
        globalTemplateId: globalId,
        name: "Client B onboarding",
      },
      state.actor,
    )
  ).id;
  first = (
    await createStep(
      globalId,
      { title: "Confirm domain", body: doc("Domain {{org.ad_full_name}}") },
      state.actor,
    )
  ).id;
  repeated = (
    await createStep(
      globalId,
      {
        title: "Review {{item.name}}",
        body: doc("App {{item.name}}"),
        repeatVariableId: apps,
      },
      state.actor,
    )
  ).id;
  localA = (
    await createStep(
      childA,
      {
        title: "Client A only",
        body: doc("Client A instructions"),
        anchorItemId: first,
        placement: "after",
      },
      state.actor,
    )
  ).id;
  localB = (
    await createStep(
      childB,
      {
        title: "Client B only",
        body: doc("Client B instructions"),
        placement: "start",
      },
      state.actor,
    )
  ).id;
});
async function changeOrder(
  id: string,
  moved: string,
  target: string,
  side: "before" | "after",
) {
  const workspace = (await loadWorkspace(id))!,
    next = moveStep(workspace.steps, moved, target, side);
  await saveOrder(
    id,
    {
      movedItemId: moved,
      expectedVersion: workspace.version,
      expectedParentVersion: workspace.parent?.version ?? null,
      expectedOrder: workspace.steps.map(stepOrder).map(orderEntry),
      proposedOrder: next.map(stepOrder).map(orderEntry),
    },
    state.actor,
  );
}
async function rowCount(
  table:
    | typeof schema.revisions
    | typeof schema.auditEvents
    | typeof schema.checklists
    | typeof schema.checklistActivity,
) {
  return Number(
    (await state.db.select({ value: count() }).from(table))[0].value,
  );
}
describe("template inheritance and local ownership", () => {
  it("preserves step-title spaces through creation, autosave, and workspace reloads", async () => {
    const createdResponse = await itemPost(request({ title: "O365 - ", body: doc("Instructions") }), context(globalId));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).data;
    expect(created.title).toBe("O365 - ");
    expect((await loadWorkspace(childA))!.steps.find((step) => step.id === created.id)?.title).toBe("O365 - ");
    for (const [templateId, itemId] of [[globalId, created.id], [childA, localA]]) {
      const response = await itemPatch(request({ title: "  O365 - User access  ", expectedVersion: 1 }, "PATCH", `http://localhost/api/items?itemId=${itemId}`), context(templateId));
      expect(response.status).toBe(200);
      expect((await response.json()).data.title).toBe("  O365 - User access  ");
      expect((await loadWorkspace(templateId))!.steps.find((step) => step.id === itemId)?.title).toBe("  O365 - User access  ");
    }
  });
  it("preserves a title's spaces when restoring a step from history", async () => {
    const created = await createStep(globalId, { title: "O365 - ", body: doc("Instructions") }, state.actor);
    await deleteStep(globalId, created.id, state.actor);
    const [revision] = await state.db.select().from(schema.revisions).where(eq(schema.revisions.entityId, created.id));
    const response = await restoreRevision(new Request("http://localhost/restore", { method: "POST" }), context(revision.id));
    expect(response.status).toBe(200);
    expect((await loadWorkspace(globalId))!.steps.find((step) => step.id === created.id)?.title).toBe("O365 - ");
  });
  it("rejects blank and overlong autosave titles without changing the stored step", async () => {
    for (const title of ["", "   ", "\t\n", "x".repeat(301)]) {
      const response = await itemPatch(request({ title, expectedVersion: 1 }, "PATCH", `http://localhost/api/items?itemId=${first}`), context(globalId));
      expect(response.status).toBe(400);
    }
    const stored = (await loadWorkspace(globalId))!.steps.find((step) => step.id === first)!;
    expect(stored.title).toBe("Confirm domain");
    expect(stored.version).toBe(1);
  });
  it("inherits global content and ordering while isolating client-local instructions", async () => {
    expect(
      visibleOrder((await loadWorkspace(childA))!.steps).map((step) => step.id),
    ).toEqual([first, localA, repeated]);
    expect(
      (await loadWorkspace(childB))!.steps.some((step) => step.id === localA),
    ).toBe(false);
    const base = (await loadWorkspace(globalId))!.steps.find(
      (step) => step.id === first,
    )!;
    await changeStep(
      globalId,
      first,
      { title: "Updated standard", expectedVersion: base.version },
      state.actor,
    );
    expect(
      (await loadWorkspace(childA))!.steps.find((step) => step.id === first)
        ?.title,
    ).toBe("Updated standard");
    await changeOrder(globalId, first, repeated, "after");
    expect(
      visibleOrder((await loadWorkspace(childA))!.steps).map((step) => step.id),
    ).toEqual([repeated, first, localA]);
    expect(
      (await loadWorkspace(childB))!.steps.find((step) => step.id === localB)
        ?.placement,
    ).toBe("start");
  });
  it("rejects edits and ordering changes to inherited steps", async () => {
    await expect(
      changeStep(
        childA,
        first,
        { title: "Forbidden", expectedVersion: 1 },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(deleteStep(childA, first, state.actor)).rejects.toMatchObject({
      status: 403,
    });
    const workspace = (await loadWorkspace(childA))!;
    await expect(
      saveOrder(
        childA,
        {
          movedItemId: first,
          expectedVersion: workspace.version,
          expectedParentVersion: workspace.parent!.version,
          expectedOrder: workspace.steps.map(stepOrder),
          proposedOrder: workspace.steps.map(stepOrder),
        },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("supports start/end placements and repairing a missing anchor without moving another org's additions", async () => {
    await deleteStep(globalId, first, state.actor);
    const context = await loadTemplateContext(childA, orgA);
    expect(context?.valid).toBe(false);
    expect(context?.issues).toContainEqual({
      code: "missing_anchor",
      itemId: localA,
    });
    expect(visibleOrder((await loadWorkspace(childA))!.steps).at(-1)?.id).toBe(
      localA,
    );
    await expect(
      createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await rowCount(schema.checklists)).toBe(0);
    await changeOrder(childA, localA, "end", "after");
    expect((await loadTemplateContext(childA, orgA))?.valid).toBe(true);
    expect(
      (await loadWorkspace(childB))!.steps.find((step) => step.id === localB)
        ?.placement,
    ).toBe("start");
  });
  it("rejects stale parent versions, foreign IDs and invalid anchors without partial updates", async () => {
    const before = (await loadWorkspace(childA))!,
      proposed = moveStep(before.steps, localA, repeated, "before");
    await changeStep(
      globalId,
      first,
      { title: "New global version", expectedVersion: 1 },
      state.actor,
    );
    await expect(
      saveOrder(
        childA,
        {
          movedItemId: localA,
          expectedVersion: before.version,
          expectedParentVersion: before.parent!.version,
          expectedOrder: before.steps.map(stepOrder),
          proposedOrder: proposed.map(stepOrder),
        },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await loadWorkspace(childA))!.steps.find((step) => step.id === localA)
        ?.anchorItemId,
    ).toBe(first);
    const fresh = (await loadWorkspace(childA))!;
    await expect(
      saveOrder(
        childA,
        {
          movedItemId: localA,
          expectedVersion: fresh.version,
          expectedParentVersion: fresh.parent!.version,
          expectedOrder: fresh.steps.map(stepOrder),
          proposedOrder: fresh.steps.map((step) => ({
            ...stepOrder(step),
            itemId: step.id === localA ? localB : step.id,
          })),
        },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createStep(
        childA,
        {
          title: "Invalid",
          body: doc("Invalid anchor"),
          placement: "after",
          anchorItemId: localB,
        },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("restores order atomically and rejects changed local membership", async () => {
    const original = (await loadWorkspace(childA))!.steps
      .filter((step) => !step.inherited)
      .map(stepOrder)
      .map(orderEntry);
    await changeOrder(childA, localA, repeated, "after");
    await restoreOrder(childA, original, state.actor);
    expect(
      (await loadWorkspace(childA))!.steps.find((step) => step.id === localA)
        ?.anchorItemId,
    ).toBe(first);
    await createStep(
      childA,
      { title: "Another local", body: doc("Only here") },
      state.actor,
    );
    await expect(
      restoreOrder(childA, original, state.actor),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("recovers soft-deleted owned steps through entity history", async () => {
    await deleteStep(childA, localA, state.actor);
    const [revision] = await state.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.entityId, localA));
    const response = await restoreRevision(
      new Request("http://localhost/restore", { method: "POST" }),
      context(revision.id),
    );
    expect(response.status).toBe(200);
    expect(
      (await loadWorkspace(childA))!.steps.some((step) => step.id === localA),
    ).toBe(true);
    expect(
      (
        await state.db
          .select()
          .from(schema.revisions)
          .where(eq(schema.revisions.entityId, localA))
      ).length,
    ).toBe(2);
  });
  it("protects linked global templates and prevents parent reassignment", async () => {
    await expect(deleteTemplate(globalId, state.actor)).rejects.toMatchObject({
      status: 409,
    });
    const response = await templatePatch(
      request({ globalTemplateId: randomUUID(), expectedVersion: 1 }, "PATCH"),
      context(childA),
    );
    expect(response.status).toBe(400);
    expect((await loadWorkspace(childA))!.parent?.id).toBe(globalId);
  });
  it("rolls back ordering, versions, revisions, and audit together", async () => {
    const before = (await loadWorkspace(childA))!,
      revisionCount = await rowCount(schema.revisions);
    await client.exec(
      "CREATE FUNCTION fail_order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='template.order_changed' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END; $$; CREATE TRIGGER order_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_order_audit();",
    );
    try {
      await expect(
        changeOrder(childA, localA, "end", "after"),
      ).rejects.toThrow();
    } finally {
      await client.exec(
        "DROP TRIGGER order_failure ON audit_events; DROP FUNCTION fail_order_audit();",
      );
    }
    expect((await loadWorkspace(childA))!.version).toBe(before.version);
    expect(
      (await loadWorkspace(childA))!.steps.find((step) => step.id === localA)
        ?.anchorItemId,
    ).toBe(first);
    expect(await rowCount(schema.revisions)).toBe(revisionCount);
  });
});
describe("approved repeated fields", () => {
  it("renders blank optional Version as Not specified only after approval and fresh sync; snapshots keep the actual null", async () => {
    await changeStep(globalId, repeated, { title: "Install {{org.applications.name}}", body: doc("Version {{org.applications.version}} / {{item.version}}"), expectedVersion: 1 }, state.actor);
    await state.db.update(schema.organizationVariableValues).set({ value: [{ id: "1", name: "One", version: null }, { id: "2", name: "Two", version: "Latest" }] }).where(eq(schema.organizationVariableValues.definitionId, apps));
    expect((await loadTemplateContext(childA, orgA))?.valid).toBe(false);
    await state.db.update(schema.variableDefinitions).set({ selectedFields: [{ sourceKey: "name", alias: "name", expectedKind: "Text" }, { sourceKey: "version", alias: "version", expectedKind: "Text" }] }).where(eq(schema.variableDefinitions.id, apps));
    const ready = (await loadTemplateContext(childA, orgA))!;
    expect(ready.valid).toBe(true);
    expect(ready.steps.at(-2)?.body).toEqual(doc("Version Not specified / Not specified"));
    expect(ready.steps.at(-1)?.body).toEqual(doc("Version Latest / Latest"));
    const created = await createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor);
    const frozen = (await loadChecklist(created.id))!;
    expect(frozen.variableSnapshot["org.applications"].value).toEqual([{ id: "1", name: "One", version: null }, { id: "2", name: "Two", version: "Latest" }]);
    expect(frozen.steps.at(-2)?.body).toEqual(doc("Version Not specified / Not specified"));
    await state.db.update(schema.variableDefinitions).set({ validationRules: { requiredFields: ["name", "version"] } }).where(eq(schema.variableDefinitions.id, apps));
    expect((await loadTemplateContext(childA, orgA))?.valid).toBe(false);
    await expect(createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor)).rejects.toMatchObject({ status: 409 });
    await state.db.update(schema.variableDefinitions).set({ validationRules: { requiredFields: ["name"] } }).where(eq(schema.variableDefinitions.id, apps));
    await state.db.update(schema.organizationVariableValues).set({ status: "pending", issues: ["mapping_changed_requires_sync"] }).where(eq(schema.organizationVariableValues.definitionId, apps));
    const pending = (await loadTemplateContext(childA, orgA))!;
    expect(pending.valid).toBe(false);
    expect(pending.steps.at(-2)?.body).toEqual(doc("Version {{org.applications.version}} / {{item.version}}"));
  });
  it("keeps the explicit organization refresh endpoint restricted to administrators", async () => {
    for (const role of ["viewer", "editor"] as const) {
      state.role = role;
      expect((await syncRoute(new Request("http://localhost/sync", { method: "POST" }), context(orgA))).status).toBe(403);
    }
  });
  it("renders qualified and short field tokens, tracks the parent variable, and freezes only approved values", async () => {
    await state.db.update(schema.variableDefinitions).set({ selectedFields: [
      { sourceKey: "name", alias: "name", expectedKind: "Text" },
      { sourceKey: "version", alias: "version", expectedKind: "Text" },
    ] }).where(eq(schema.variableDefinitions.id, apps));
    await state.db.update(schema.organizationVariableValues).set({ value: [
      { id: "1", name: "Photoshop", version: "Latest", unapproved: "discard" },
      { id: "2", name: "Acrobat", version: "2026" },
    ] }).where(eq(schema.organizationVariableValues.definitionId, apps));
    await changeStep(globalId, repeated, {
      title: "Install {{org.applications.name}} {{org.applications.version}}",
      body: doc("{{item.name}} {{item.version}} on {{org.ad_full_name}}"),
      expectedVersion: 1,
    }, state.actor);
    const context = (await loadTemplateContext(childA, orgA))!;
    expect(context.valid).toBe(true);
    expect(context.variables.find((variable) => variable.id === apps)).toMatchObject({ used: true, fieldAliases: ["name", "version"] });
    expect(context.steps.slice(-2).map((step) => step.title)).toEqual(["Install Photoshop Latest", "Install Acrobat 2026"]);
    const created = await createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor);
    const frozen = (await loadChecklist(created.id))!;
    expect(frozen.variableSnapshot["org.applications"].value).toEqual([
      { id: "1", name: "Photoshop", version: "Latest" },
      { id: "2", name: "Acrobat", version: "2026" },
    ]);
    expect(frozen.steps.at(-1)?.body).toEqual(doc("Acrobat 2026 on client-a.local"));
    expect(JSON.stringify(frozen)).not.toContain("discard");
    await state.db.update(schema.organizationVariableValues).set({ value: [] }).where(eq(schema.organizationVariableValues.definitionId, apps));
    expect((await loadChecklist(created.id))!.steps).toEqual(frozen.steps);
  });
  it("refuses unapproved fields even if present in stored data or if the list is empty", async () => {
    await changeStep(globalId, repeated, {
      title: "{{org.applications.unapproved}} {{item.version}}",
      expectedVersion: 1,
    }, state.actor);
    for (const value of [[{ name: "App", unapproved: "discard", version: "Latest" }], []]) {
      await state.db.update(schema.organizationVariableValues).set({ value }).where(eq(schema.organizationVariableValues.definitionId, apps));
      const context = (await loadTemplateContext(childA, orgA))!;
      expect(context.valid).toBe(false);
      expect(context.issues).toEqual(expect.arrayContaining([
        { code: "missing_variable", itemId: repeated, variableKey: "org.applications.unapproved" },
        { code: "missing_variable", itemId: repeated, variableKey: "item.version" },
      ]));
      expect(JSON.stringify(context.variables)).not.toContain("discard");
      await expect(createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor)).rejects.toMatchObject({ status: 409 });
    }
    expect(await rowCount(schema.checklists)).toBe(0);
  });
  it("does not let qualified field tokens bypass disabled definitions or the organization's freshness checks", async () => {
    await changeStep(globalId, repeated, { title: "{{org.applications.name}}", expectedVersion: 1 }, state.actor);
    await state.db.update(schema.organizationVariableValues).set({ syncedAt: new Date(Date.now() - 90000000) }).where(eq(schema.organizationVariableValues.organizationId, orgA));
    expect((await loadTemplateContext(childA, orgA))?.invalidVariables).toContain("org.applications");
    expect((await loadTemplateContext(childB, orgB))?.valid).toBe(true);
    await state.db.update(schema.variableDefinitions).set({ enabled: false }).where(eq(schema.variableDefinitions.id, apps));
    expect((await loadTemplateContext(childB, orgB))?.invalidVariables).toContain("org.applications");
  });
  it("requires schema validation after changing approved fields and preserves validation on label-only edits", async () => {
    const label = await mappingPatch(request({ label: "Apps" }, "PATCH", `http://localhost/api/variables?id=${apps}`));
    expect(label.status).toBe(200);
    expect((await label.json()).data.schemaValid).toBe(true);
    const changed = await mappingPatch(request({ selectedFields: [
      { sourceKey: "name", alias: "name", expectedKind: "Text" },
      { sourceKey: "version", alias: "version", expectedKind: "Text" },
    ] }, "PATCH", `http://localhost/api/variables?id=${apps}`));
    expect(changed.status).toBe(200);
    expect((await changed.json()).data.schemaValid).toBe(false);
    expect((await loadWorkspace(globalId))!.definitions.find((definition) => definition.id === apps)?.fieldAliases).toEqual(["name", "version"]);
    expect((await loadTemplateContext(childA, orgA))?.valid).toBe(false);
    // Schema review alone must not bless values synchronized under an old mapping.
    await state.db.update(schema.variableDefinitions).set({ schemaValid: true }).where(eq(schema.variableDefinitions.id, apps));
    const pending = (await loadTemplateContext(childA, orgA))!;
    expect(pending.variables.find((variable) => variable.id === apps)).toMatchObject({ status: "pending", issues: ["mapping_changed_requires_sync"] });
    expect(pending.valid).toBe(false);
  });
  it("rejects duplicate aliases and password/upload kinds regardless of case, and restricts mapping writes to admins", async () => {
    for (const selectedFields of [
      [{ sourceKey: "name", alias: "name", expectedKind: "Text" }, { sourceKey: "version", alias: "name", expectedKind: "Text" }],
      [{ sourceKey: "password", alias: "password", expectedKind: "PASSWORD" }],
      [{ sourceKey: "attachment", alias: "attachment", expectedKind: "upload" }],
    ]) expect((await mappingPatch(request({ selectedFields }, "PATCH", `http://localhost/api/variables?id=${apps}`))).status).toBe(400);
    for (const role of ["viewer", "editor"] as const) {
      state.role = role;
      expect((await mappingPatch(request({ label: "No" }, "PATCH", `http://localhost/api/variables?id=${apps}`))).status).toBe(403);
    }
    state.role = "admin";
    const created = await mappingPost(request({ key: "org.other", label: "Other", assetTypeId: "1", assetTypeName: "Other", cardinality: "list", selectedFields: [{ sourceKey: "name", alias: "name", expectedKind: "Text" }], validationRules: {} }));
    expect(created.status).toBe(201);
    expect((await created.json()).data.schemaValid).toBe(false);
  });
  it("does not let an in-flight sync reapprove values after the mapping changes", async () => {
    vi.stubEnv("ITGLUE_API_KEY", "test-only");
    const reader = vi.spyOn(ItGlueClient.prototype, "getFlexibleAssets").mockImplementation(async (input) => {
      if (input.assetTypeId === "107504") return [{ id: "ad", name: "AD", fields: { value: "example.test" } }];
      await mappingPatch(request({ selectedFields: [
        { sourceKey: "name", alias: "name", expectedKind: "Text" },
        { sourceKey: "version", alias: "version", expectedKind: "Text" },
      ] }, "PATCH", `http://localhost/api/variables?id=${apps}`));
      return [{ id: "app", name: "App", fields: { name: "Old mapping result" } }];
    });
    try {
      const result = await syncOrganization(orgA, "manual", state.actor);
      expect(result.issues).toContain("org.applications:mapping_changed_during_sync");
      expect((await loadTemplateContext(childA, orgA))!.variables.find((variable) => variable.id === apps)?.status).toBe("invalid");
      const [stored] = await state.db.select().from(schema.organizationVariableValues).where(eq(schema.organizationVariableValues.definitionId, apps));
      expect(stored.status).toBe("pending");
      expect(JSON.stringify(stored.value)).not.toContain("Old mapping result");
    } finally { reader.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("returns a conflict instead of approving a mapping edited during schema validation", async () => {
    vi.stubEnv("ITGLUE_API_KEY", "test-only");
    await state.db.update(schema.variableDefinitions).set({ updatedAt: new Date("2000-01-01") }).where(eq(schema.variableDefinitions.id, apps));
    const reader = vi.spyOn(ItGlueClient.prototype, "getFlexibleAssetType").mockImplementation(async (id) => {
      await mappingPatch(request({ selectedFields: [
        { sourceKey: "name", alias: "name", expectedKind: "Text" },
        { sourceKey: "version", alias: "version", expectedKind: "Text" },
      ] }, "PATCH", `http://localhost/api/variables?id=${apps}`));
      return { id, name: "Applications", fields: [] };
    });
    try {
      const result = await validateMapping(new Request("http://localhost/validate", { method: "POST" }), context(apps));
      expect(result.status).toBe(409);
      expect((await state.db.select().from(schema.variableDefinitions).where(eq(schema.variableDefinitions.id, apps)))[0].schemaValid).toBe(false);
    } finally { reader.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("validates explicitly selected Name/version traits and only reactivates values after sync", async () => {
    vi.stubEnv("ITGLUE_API_KEY", "test-only");
    const selectedFields = [
      { sourceKey: "traits.name", alias: "name", expectedKind: "Text" },
      { sourceKey: "version", alias: "version", expectedKind: "Text" },
    ];
    const saved = await mappingPatch(request({ selectedFields }, "PATCH", `http://localhost/api/variables?id=${apps}`));
    expect(saved.status).toBe(200);
    const schemaReader = vi.spyOn(ItGlueClient.prototype, "getFlexibleAssetType").mockResolvedValue({ id: "107505", name: "Applications", fields: [{ key: "name", name: "Name", kind: "Text" }, { key: "version", name: "Version", kind: "Text" }] });
    const valueReader = vi.spyOn(ItGlueClient.prototype, "getFlexibleAssets").mockImplementation(async (input) => {
      if (input.assetTypeId === "107504") return [{ id: "ad", name: "AD", fields: { value: "example.test" } }];
      expect(input.selectedFields).toEqual(selectedFields);
      return [{ id: "app", name: "Display name", fields: { name: "Application Name", version: "Latest" } }];
    });
    try {
      const validated = await validateMapping(new Request("http://localhost/validate", { method: "POST" }), context(apps));
      expect(validated.status).toBe(200);
      expect((await validated.json()).data.schemaValid).toBe(true);
      expect((await loadTemplateContext(childA, orgA))!.variables.find((variable) => variable.id === apps)?.status).toBe("pending");
      expect((await syncOrganization(orgA, "manual", state.actor)).status).toBe("valid");
      const contextAfterSync = (await loadTemplateContext(childA, orgA))!;
      expect(contextAfterSync.valid).toBe(true);
      expect(contextAfterSync.variables.find((variable) => variable.id === apps)?.value).toEqual([{ id: "app", name: "Application Name", version: "Latest" }]);
      // PostgreSQL JSONB key order must not turn an unchanged save into a mapping change.
      expect((await mappingPatch(request({ selectedFields }, "PATCH", `http://localhost/api/variables?id=${apps}`))).status).toBe(200);
      expect((await loadTemplateContext(childA, orgA))?.valid).toBe(true);
    } finally { schemaReader.mockRestore(); valueReader.mockRestore(); vi.unstubAllEnvs(); }
  });
});
describe("archived IT Glue assets", () => {
  it.each(["manual", "cron"] as const)("excludes archived AD, Applications and Email during %s syncs", async (trigger) => {
    vi.stubEnv("ITGLUE_API_KEY", "test-only");
    const [email] = await state.db.insert(schema.variableDefinitions).values({
      key: "org.email", label: "Email", assetTypeId: "456789", assetTypeName: "Email", cardinality: "scalar",
      selectedFields: [
        { sourceKey: "type", alias: "type", expectedKind: "Select" },
        { sourceKey: "location", alias: "service_location", expectedKind: "Select" },
        { sourceKey: "inbound-delivery", alias: "inbound_delivery_spam_filter", expectedKind: "Select" },
      ], validationRules: { exactRecords: 1, requiredFields: ["type", "service_location", "inbound_delivery_spam_filter"] },
    }).returning();
    await createStep(childA, { title: "Email {{org.email.type}}", body: doc("{{org.email.service_location}} / {{org.email.inbound_delivery_spam_filter}}"), placement: "end" }, state.actor);
    let mode: "mixed" | "unknown" | "archived-only" = "mixed";
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = new URL(String(input));
      expect(options?.method).toBe("GET");
      expect(url.pathname).toBe("/flexible_assets");
      expect(url.searchParams.get("filter[organization-id]")).toBe("1");
      expect(url.searchParams.get("page[size]")).toBe("1000");
      const typeId = url.searchParams.get("filter[flexible-asset-type-id]");
      const traits = typeId === "107504" ? { "ad-full-name": "active.test" }
        : typeId === "456789" ? { type: "Office 365", location: "Cloud", "inbound-delivery": "Inky" } : {};
      const archived = { id: "old-" + typeId, attributes: { archived: true, name: "Archived item - must not import", traits: { "ad-full-name": "archived.test", type: "Retired", location: "Old location", "inbound-delivery": "Retired filter" } } };
      const active = { id: "active-" + typeId, attributes: { archived: mode === "unknown" ? null : false, name: "Active application", traits } };
      return Response.json({ data: mode === "archived-only" ? [archived] : [archived, active] });
    });
    vi.stubGlobal("fetch", fetcher);
    const values = () => state.db.select().from(schema.organizationVariableValues).where(eq(schema.organizationVariableValues.organizationId, orgA));
    const actor = trigger === "manual" ? state.actor : undefined;
    try {
      expect((await syncOrganization(orgA, trigger, actor)).status).toBe("valid");
      const firstValues = await values();
      expect(firstValues.find((value) => value.definitionId === ad)).toMatchObject({ status: "valid", value: "active.test" });
      expect(firstValues.find((value) => value.definitionId === apps)?.value).toEqual([{ id: "active-107505", name: "Active application" }]);
      expect(firstValues.find((value) => value.definitionId === email.id)?.value).toEqual({ type: "Office 365", service_location: "Cloud", inbound_delivery_spam_filter: "Inky" });
      expect(JSON.stringify(firstValues)).not.toMatch(/archived\.test|Retired|Archived item|Old location/);
      const created = await createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor);
      const frozen = (await loadChecklist(created.id))!;

      mode = "unknown";
      expect((await syncOrganization(orgA, trigger, actor)).status).toBe("invalid");
      for (const previous of firstValues) {
        const retained = (await values()).find((value) => value.definitionId === previous.definitionId)!;
        expect(retained.status).toBe("stale");
        expect(retained.value).toEqual(previous.value);
        expect(retained.lastGoodAt).toEqual(previous.lastGoodAt);
      }

      mode = "archived-only";
      expect((await syncOrganization(orgA, trigger, actor)).status).toBe("invalid");
      const archivedValues = await values();
      expect(archivedValues.find((value) => value.definitionId === apps)).toMatchObject({ status: "valid", value: [] });
      for (const definitionId of [ad, email.id])
        expect(archivedValues.find((value) => value.definitionId === definitionId)).toMatchObject({ status: "invalid", issues: ["expected_1_records_found_0"] });
      expect((await loadTemplateContext(childA, orgA))?.invalidVariables).toEqual(expect.arrayContaining(["org.ad_full_name", "org.email"]));
      expect((await loadTemplateContext(childB, orgB))?.valid).toBe(true);
      await expect(createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor)).rejects.toMatchObject({ status: 409 });
      expect((await loadChecklist(created.id))?.steps).toEqual(frozen.steps);
      expect(JSON.stringify(archivedValues)).not.toMatch(/archived\.test|Retired|Archived item|Old location/);
      expect(fetcher).toHaveBeenCalledTimes(9);
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
});

describe("single Email variable preset", () => {
  const emailFields = [
    { key: "email-platform", name: "Type", kind: "Select" },
    { key: "hosting-location", name: "Service Location", kind: "Select" },
    { key: "inbound-delivery", name: "Inbound Delivery - Spam Filter", kind: "Select" },
  ];
  function schemaFetch() {
    vi.stubEnv("ITGLUE_API_KEY", "test-only");
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      expect(options?.method).toBe("GET");
      const url = new URL(String(input));
      if (url.pathname === "/flexible_asset_types") return Response.json({ data: url.searchParams.get("filter[name]") === "Email" ? [{ id: "456789", attributes: { name: "Email" } }] : [] });
      expect(url.pathname).toBe("/flexible_asset_types/456789");
      return Response.json({
        data: { id: "456789", attributes: { name: "Email" }, relationships: { "flexible-asset-fields": { data: emailFields.map((_, index) => ({ id: String(index + 1) })) } } },
        included: emailFields.map((field, index) => ({ id: String(index + 1), type: "flexible-asset-fields", attributes: { name: field.name, "name-key": field.key, kind: field.kind, hint: "discard-metadata" } })),
      });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }
  it("creates one audited, validated mapping without fetching organization records or overwriting another mapping", async () => {
    const fetcher = schemaFetch();
    const previous = await state.db.select().from(schema.variableDefinitions);
    try {
      const response = await addEmailVariable();
      expect(response.status).toBe(201);
      const email = (await response.json()).data;
      expect(email).toMatchObject({ key: "org.email", assetTypeId: "456789", cardinality: "scalar", schemaValid: true });
      expect(email.selectedFields).toHaveLength(3);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(await state.db.select().from(schema.organizationVariableValues).where(eq(schema.organizationVariableValues.definitionId, email.id))).toHaveLength(0);
      const events = await state.db.select().from(schema.auditEvents);
      expect(events.filter((event) => event.eventType === "itglue.request.preview")).toHaveLength(3);
      expect(events.find((event) => event.eventType === "variable_definition.created")?.details).toMatchObject({ key: "org.email", preset: "email" });
      expect(JSON.stringify(events)).not.toMatch(/test-only|discard-metadata/);
      expect((await addEmailVariable()).status).toBe(409);
      expect(fetcher).toHaveBeenCalledTimes(3);
      const definitions = await state.db.select().from(schema.variableDefinitions);
      expect(definitions).toHaveLength(previous.length + 1);
      for (const definition of previous) expect(definitions.find((row) => row.id === definition.id)).toEqual(definition);
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
  it("restricts creation to enabled admins without making IT Glue requests for other roles", async () => {
    const fetcher = schemaFetch();
    try {
      for (const role of ["viewer", "editor"] as const) {
        state.role = role;
        expect((await addEmailVariable()).status).toBe(403);
      }
      state.role = "admin";
      state.enabled = false;
      expect((await addEmailVariable()).status).toBe(401);
      expect(fetcher).not.toHaveBeenCalled();
      expect(await state.db.select().from(schema.variableDefinitions).where(eq(schema.variableDefinitions.key, "org.email"))).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
  it("leaves mappings unchanged when discovery fails and never returns raw API errors", async () => {
    vi.stubEnv("ITGLUE_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-upstream-error", { status: 403 })));
    try {
      const response = await addEmailVariable();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "email_schema_lookup_failed" });
      expect(await state.db.select().from(schema.variableDefinitions)).toHaveLength(2);
      expect(JSON.stringify(await state.db.select().from(schema.auditEvents))).not.toMatch(/private-upstream-error|test-only/);
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
  it("syncs only approved Email fields and freezes resolved instructions; pending/stale Email blocks only affected templates", async () => {
    schemaFetch();
    const reader = vi.spyOn(ItGlueClient.prototype, "getFlexibleAssets").mockImplementation(async (input) => {
      if (input.assetTypeId === "107504") return [{ id: "ad", name: "AD", fields: { value: "example.test" } }];
      if (input.assetTypeId === "107505") return [{ id: "app", name: "App", fields: { name: "App" } }];
      expect(input.assetTypeId).toBe("456789");
      expect(input.selectedFields.map((field) => field.sourceKey)).toEqual(emailFields.map((field) => field.key));
      return [{ id: "email", name: "Office 365", fields: { type: "Office 365", service_location: "Cloud", inbound_delivery_spam_filter: "Inky" } }];
    });
    try {
      const response = await addEmailVariable();
      const email = (await response.json()).data;
      await createStep(childA, { title: "Configure {{org.email.type}}", body: doc("{{org.email.service_location}} / {{org.email.inbound_delivery_spam_filter}}"), placement: "end" }, state.actor);
      expect((await loadTemplateContext(childA, orgA))?.invalidVariables).toContain("org.email");
      expect((await loadTemplateContext(childB, orgB))?.valid).toBe(true);
      expect((await syncOrganization(orgA, "manual", state.actor)).status).toBe("valid");
      const resolved = (await loadTemplateContext(childA, orgA))!;
      expect(resolved.valid).toBe(true);
      expect(resolved.steps.at(-1)).toMatchObject({ title: "Configure Office 365", body: doc("Cloud / Inky") });
      const created = await createChecklist({ templateId: childA, creationKey: randomUUID() }, state.actor);
      const frozen = (await loadChecklist(created.id))!;
      expect(frozen.variableSnapshot["org.email"].value).toEqual({ type: "Office 365", service_location: "Cloud", inbound_delivery_spam_filter: "Inky" });
      await state.db.update(schema.organizationVariableValues).set({ value: { type: "Changed" }, syncedAt: new Date(Date.now() - 86400001) }).where(eq(schema.organizationVariableValues.definitionId, email.id));
      expect((await loadTemplateContext(childA, orgA))?.invalidVariables).toContain("org.email");
      expect((await loadTemplateContext(childB, orgB))?.valid).toBe(true);
      expect((await loadChecklist(created.id))?.steps).toEqual(frozen.steps);
    } finally { reader.mockRestore(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
});

describe("frozen shared checklists", () => {
  it("freezes resolved variables, inherited/local instructions, repetition and versions", async () => {
    const created = await createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
      frozen = (await loadChecklist(created.id))!;
    expect(frozen.total).toBe(4);
    expect(frozen.steps.map((step) => step.title)).toEqual([
      "Confirm domain",
      "Client A only",
      "Review One",
      "Review Two",
    ]);
    expect(JSON.stringify(frozen.steps)).toContain("client-a.local");
    expect(JSON.stringify(frozen.variableSnapshot)).not.toContain("unapproved");
    await changeStep(
      globalId,
      first,
      {
        title: "Changed after creation",
        body: doc("Changed"),
        expectedVersion: 1,
      },
      state.actor,
    );
    await changeStep(
      childA,
      localA,
      { title: "Changed local", expectedVersion: 1 },
      state.actor,
    );
    await state.db
      .update(schema.organizationVariableValues)
      .set({ value: "new.local" })
      .where(eq(schema.organizationVariableValues.definitionId, ad));
    const later = (await loadChecklist(created.id))!;
    expect(later.steps).toEqual(frozen.steps);
    expect(later.variableSnapshot).toEqual(frozen.variableSnapshot);
    expect(
      (
        await createChecklist(
          { templateId: childA, creationKey: randomUUID() },
          state.actor,
        )
      ).templateVersion,
    ).toBeGreaterThan(frozen.templateVersion);
  });
  it("is idempotent and refuses reuse of a key for different input", async () => {
    const key = randomUUID(),
      one = await createChecklist(
        { templateId: childA, name: "One run", creationKey: key },
        state.actor,
      ),
      two = await createChecklist(
        { templateId: childA, name: "One run", creationKey: key },
        state.actor,
      );
    expect(two.id).toBe(one.id);
    expect(await rowCount(schema.checklists)).toBe(1);
    await expect(
      createChecklist({ templateId: childB, creationKey: key }, state.actor),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("allows another signed-in user to complete, skip, add notes and reopen finished work", async () => {
    const run = await createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
      steps = (await loadChecklist(run.id))!.steps;
    for (const step of steps.slice(0, -1))
      await changeChecklistStep(
        run.id,
        step.id,
        { expectedVersion: step.version, status: "completed" },
        otherActor,
      );
    const last = steps.at(-1)!;
    await changeChecklistStep(
      run.id,
      last.id,
      {
        expectedVersion: last.version,
        status: "skipped",
        skipReason: "Not required for this request",
        notes: "Confirmed with client",
      },
      otherActor,
    );
    const completed = (await loadChecklist(run.id))!;
    expect(completed.status).toBe("completed");
    expect(completed.completed).toBe(3);
    expect(completed.skipped).toBe(1);
    expect(completed.people[otherActor]).toBe("Operator Two");
    await changeChecklistStep(
      run.id,
      completed.steps[0].id,
      { expectedVersion: completed.steps[0].version, status: "pending" },
      state.actor,
    );
    expect((await loadChecklist(run.id))!.status).toBe("active");
    expect((await loadChecklist(run.id))!.completedAt).toBeNull();
    expect(
      (await loadActivity(run.id)).data.map((entry) => entry.event),
    ).toContain("reopened");
  });
  it("requires skip reasons, bounds note length, rejects instruction changes, and detects concurrent edits", async () => {
    const run = await createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
      step = (await loadChecklist(run.id))!.steps[0];
    await expect(
      changeChecklistStep(
        run.id,
        step.id,
        { expectedVersion: 1, status: "skipped", skipReason: " " },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      changeChecklistStep(
        run.id,
        step.id,
        { expectedVersion: 1, notes: "x".repeat(2001) },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await changeChecklistStep(
      run.id,
      step.id,
      { expectedVersion: 1, notes: "First update" },
      state.actor,
    );
    await expect(
      changeChecklistStep(
        run.id,
        step.id,
        { expectedVersion: 1, status: "completed" },
        otherActor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const altered = await progressRoute(
      request({ expectedVersion: 2, title: "Overwrite instructions" }, "PATCH"),
      { params: Promise.resolve({ id: run.id, stepId: step.id }) },
    );
    expect(altered.status).toBe(400);
    expect((await loadChecklist(run.id))!.steps[0].title).toBe(step.title);
    expect(
      (await loadActivity(run.id)).data.filter(
        (entry) => entry.event === "step_updated",
      ),
    ).toHaveLength(1);
  });
  it("rejects foreign step IDs and deleted checklists", async () => {
    const one = await createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
      two = await createChecklist(
        { templateId: childB, creationKey: randomUUID() },
        state.actor,
      ),
      foreign = (await loadChecklist(two.id))!.steps[0];
    await expect(
      changeChecklistStep(
        one.id,
        foreign.id,
        { expectedVersion: 1, status: "completed" },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await setChecklistDeleted(one.id, true, state.actor);
    expect(await loadChecklist(one.id)).toBeNull();
    await expect(
      changeChecklistStep(
        one.id,
        (await loadChecklist(one.id, true))!.steps[0].id,
        { expectedVersion: 1, status: "completed" },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await setChecklistDeleted(one.id, false, state.actor);
    expect(await loadChecklist(one.id)).not.toBeNull();
  });
  it("keeps runnable snapshots after source templates are removed", async () => {
    const run = await createChecklist(
      { templateId: childA, creationKey: randomUUID() },
      state.actor,
    );
    await deleteTemplate(childA, state.actor);
    await deleteTemplate(childB, state.actor);
    await deleteTemplate(globalId, state.actor);
    const frozen = (await loadChecklist(run.id))!;
    await changeChecklistStep(
      run.id,
      frozen.steps[0].id,
      { expectedVersion: 1, status: "completed" },
      otherActor,
    );
    expect((await loadChecklist(run.id))!.completed).toBe(1);
  });
  it("creates nothing on stale data, schema incompatibility, or malformed/oversized lists", async () => {
    await state.db
      .update(schema.organizationVariableValues)
      .set({ syncedAt: new Date(Date.now() - 90000000) })
      .where(eq(schema.organizationVariableValues.organizationId, orgA));
    await expect(
      createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await loadTemplateContext(childB, orgB))?.valid).toBe(true);
    expect(await rowCount(schema.checklists)).toBe(0);
    await state.db
      .update(schema.organizationVariableValues)
      .set({ syncedAt: new Date(), value: ["malformed fixture"] })
      .where(eq(schema.organizationVariableValues.definitionId, apps));
    expect(
      (await loadTemplateContext(childB, orgB))?.variables.find(
        (value) => value.id === apps,
      )?.value,
    ).toBeNull();
    await expect(
      createChecklist(
        { templateId: childB, creationKey: randomUUID() },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await state.db
      .update(schema.organizationVariableValues)
      .set({ value: Array.from({ length: 1001 }, () => ({ name: "App" })) })
      .where(eq(schema.organizationVariableValues.definitionId, apps));
    expect(
      (await loadTemplateContext(childB, orgB))?.variables.find(
        (value) => value.id === apps,
      )?.issues,
    ).toContain("record_limit_exceeded");
    await state.db
      .update(schema.variableDefinitions)
      .set({ schemaValid: false })
      .where(eq(schema.variableDefinitions.id, ad));
    expect(
      (await loadTemplateContext(childB, orgB))?.invalidVariables,
    ).toContain("org.ad_full_name");
    expect(await rowCount(schema.checklists)).toBe(0);
  });
  it("rejects empty renders and more than 1,000 resolved steps without partial creation", async () => {
    const empty = await createTemplate(
        { scope: "global", name: "Empty" },
        state.actor,
      ),
      child = await createTemplate(
        {
          scope: "organization",
          organizationId: orgA,
          globalTemplateId: empty.id,
        },
        state.actor,
      );
    await expect(
      createChecklist(
        { templateId: child.id, creationKey: randomUUID() },
        state.actor,
      ),
    ).rejects.toMatchObject({ message: "empty_checklist" });
    await state.db
      .update(schema.organizationVariableValues)
      .set({
        value: Array.from({ length: 1000 }, (_, index) => ({
          name: "App " + index,
        })),
      })
      .where(eq(schema.organizationVariableValues.definitionId, apps));
    expect(
      (await loadTemplateContext(childA, orgA))?.issues.some(
        (issue) => issue.code === "too_many_steps",
      ),
    ).toBe(true);
    await expect(
      createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await rowCount(schema.checklists)).toBe(0);
  });
  it("rolls back creation and progress when activity logging fails", async () => {
    await client.exec(
      "CREATE FUNCTION fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$; CREATE TRIGGER activity_failure BEFORE INSERT ON checklist_activity FOR EACH ROW EXECUTE FUNCTION fail_activity();",
    );
    try {
      await expect(
        createChecklist(
          { templateId: childA, creationKey: randomUUID() },
          state.actor,
        ),
      ).rejects.toThrow();
      expect(await rowCount(schema.checklists)).toBe(0);
    } finally {
      await client.exec(
        "DROP TRIGGER activity_failure ON checklist_activity; DROP FUNCTION fail_activity();",
      );
    }
    const run = await createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
      step = (await loadChecklist(run.id))!.steps[0];
    await client.exec(
      "CREATE FUNCTION fail_progress_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='step_updated' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END; $$; CREATE TRIGGER progress_failure BEFORE INSERT ON checklist_activity FOR EACH ROW EXECUTE FUNCTION fail_progress_activity();",
    );
    try {
      await expect(
        changeChecklistStep(
          run.id,
          step.id,
          { expectedVersion: 1, status: "completed" },
          otherActor,
        ),
      ).rejects.toThrow();
    } finally {
      await client.exec(
        "DROP TRIGGER progress_failure ON checklist_activity; DROP FUNCTION fail_progress_activity();",
      );
    }
    expect((await loadChecklist(run.id))!.steps[0]).toMatchObject({
      status: "pending",
      version: 1,
    });
    expect((await loadActivity(run.id)).data).toHaveLength(1);
  });
  it("filters checklist lists by client/status/name with pagination metadata", async () => {
    const a = await createChecklist(
      {
        templateId: childA,
        name: "New hire request",
        creationKey: randomUUID(),
      },
      state.actor,
    );
    await createChecklist(
      {
        templateId: childB,
        name: "Different request",
        creationKey: randomUUID(),
      },
      state.actor,
    );
    expect(
      (await listChecklists({ organizationId: orgA })).data.map(
        (run) => run.id,
      ),
    ).toEqual([a.id]);
    expect((await listChecklists({ search: "New hire" })).total).toBe(1);
    expect((await listChecklists({ status: "completed" })).total).toBe(0);
  });
});
describe("role and session boundaries", () => {
  it("lets viewers run checklists but not author templates or delete/restore instances", async () => {
    state.role = "viewer";
    for (const response of [
      await templatePost(request({ scope: "global", name: "Denied" })),
      await templatePatch(
        request({ name: "Denied", expectedVersion: 1 }, "PATCH"),
        context(globalId),
      ),
      await templateDelete(
        new Request("http://localhost/api", { method: "DELETE" }),
        context(globalId),
      ),
      await itemPost(
        request({ title: "Denied", body: doc("Denied") }),
        context(childA),
      ),
      await itemPatch(
        request(
          { title: "Denied", expectedVersion: 1 },
          "PATCH",
          "http://localhost/api?itemId=" + localA,
        ),
        context(childA),
      ),
      await orderPatch(request({}, "PATCH"), context(childA)),
      await restoreRevision(
        new Request("http://localhost/api", { method: "POST" }),
        context(randomUUID()),
      ),
    ])
      expect(response.status).toBe(403);
    const created = await createRunRoute(
      request({ templateId: childA, creationKey: randomUUID() }),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).data.id,
      step = (await loadChecklist(id))!.steps[0];
    expect(
      (
        await progressRoute(
          request({ expectedVersion: 1, status: "completed" }, "PATCH"),
          { params: Promise.resolve({ id, stepId: step.id }) },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deleteRunRoute(
          new Request("http://localhost/api", { method: "DELETE" }),
          context(id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await restoreRunRoute(
          new Request("http://localhost/api", { method: "POST" }),
          context(id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await listRunsRoute(
          new Request("http://localhost/api?includeDeleted=true"),
        )
      ).status,
    ).toBe(403);
  });
  it("denies disabled users before reads/writes and enforces disabled actors inside transactions", async () => {
    const run = await createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
      step = (await loadChecklist(run.id))!.steps[0];
    await state.db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, state.actor));
    expect(
      (await listRunsRoute(new Request("http://localhost/api"))).status,
    ).toBe(401);
    expect(
      (
        await createRunRoute(
          request({ templateId: childA, creationKey: randomUUID() }),
        )
      ).status,
    ).toBe(401);
    await expect(
      changeChecklistStep(
        run.id,
        step.id,
        { expectedVersion: 1, status: "completed" },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      createChecklist(
        { templateId: childA, creationKey: randomUUID() },
        state.actor,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("allows editor/admin template authoring and admin checklist recovery", async () => {
    state.role = "editor";
    expect(
      (
        await templatePost(
          request({ scope: "global", name: "Editor template" }),
        )
      ).status,
    ).toBe(201);
    const run = await createChecklist(
      { templateId: childA, creationKey: randomUUID() },
      state.actor,
    );
    state.role = "admin";
    expect(
      (
        await deleteRunRoute(
          new Request("http://localhost/api", { method: "DELETE" }),
          context(run.id),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await restoreRunRoute(
          new Request("http://localhost/api", { method: "POST" }),
          context(run.id),
        )
      ).status,
    ).toBe(200);
    expect(await loadChecklist(run.id)).not.toBeNull();
  });
});
