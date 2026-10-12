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
