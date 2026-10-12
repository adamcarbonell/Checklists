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
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";
import { roleAllows } from "./roles";
const state = vi.hoisted(() => ({
  db: undefined as unknown as Database,
  role: "admin" as "admin" | "editor" | "viewer",
}));
vi.mock("@/db/client", () => ({
  getDatabase: () => state.db,
  hasDatabase: () => true,
}));
vi.mock("@/lib/access", () => ({
  requireRole: async (minimum: "admin" | "editor" | "viewer") =>
    roleAllows(state.role, minimum)
      ? { ok: true, user: { id: "development-admin", role: state.role } }
      : {
          ok: false,
          response: Response.json({ error: "forbidden" }, { status: 403 }),
        },
}));
import { loadWorkspace, loadTemplateContext } from "./workspace-data";
import { saveOrder, restoreOrder, toOrder } from "./order-service";
import { moveStep } from "./template-order";
import { PATCH as reorderRoute } from "@/app/api/templates/[id]/order/route";
import {
  PATCH as globalPatch,
  DELETE as globalDelete,
} from "@/app/api/global-steps/[id]/route";
import { DELETE as removeEntry } from "@/app/api/templates/[id]/items/route";
import { validateRepeatVariable } from "./repeat-validation";
import { POST as restoreRevision } from "@/app/api/revisions/[id]/restore/route";
import { PATCH as snapshotPatch } from "@/app/api/templates/[id]/items/route";
const client = new PGlite();
let templateId: string,
  orgA: string,
  orgB: string,
  g1: string,
  g2: string,
  a: string,
  b: string,
  sourceId: string,
  adId: string;
beforeAll(async () => {
  await client.exec(
    await readFile("drizzle/0000_fixed_marten_broadcloak.sql", "utf8"),
  );
  state.db = drizzle(client, { schema }) as unknown as Database;
}, 30000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  state.role = "admin";
  await client.exec(
    "TRUNCATE templates, organizations, global_steps, organization_steps, variable_definitions, revisions, audit_events CASCADE",
  );
  const [t] = await state.db
    .insert(schema.templates)
    .values({ name: "Test template" })
    .returning();
  templateId = t.id;
  const orgs = await state.db
    .insert(schema.organizations)
    .values([
      { name: "Org A", itglueId: "1" },
      { name: "Org B", itglueId: "2" },
    ])
    .returning();
  orgA = orgs[0].id;
  orgB = orgs[1].id;
  const [definition] = await state.db
    .insert(schema.variableDefinitions)
    .values({
      key: "org.ad_full_name",
      label: "AD",
      assetTypeId: "107504",
      assetTypeName: "Active Directory",
      cardinality: "scalar",
      selectedFields: [
        { sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" },
      ],
      validationRules: { exactRecords: 1 },
    })
    .returning();
  adId = definition.id;
  await state.db.insert(schema.organizationVariableValues).values(
    orgs.map((o) => ({
      organizationId: o.id,
      definitionId: adId,
      value: "example.test",
      status: "valid" as const,
      syncedAt: new Date(),
      lastGoodAt: new Date(),
    })),
  );
  const global = await state.db
    .insert(schema.globalSteps)
    .values([
      { title: "Domain {{org.ad_full_name}}", body: { type: "doc" } },
      { title: "Second", body: { type: "doc" } },
    ])
    .returning();
  sourceId = global[0].id;
  const items = await state.db
    .insert(schema.templateItems)
    .values(
      global.map((s, i) => ({
        templateId,
        kind: "global" as const,
        globalStepId: s.id,
        position: (i + 1) * 100,
      })),
    )
    .returning();
  g1 = items[0].id;
  g2 = items[1].id;
  const snapshots = await state.db
    .insert(schema.templateItems)
    .values([
      {
        templateId,
        kind: "organization",
        organizationId: orgA,
        anchorItemId: g1,
        placement: "after",
        position: 100,
        snapshotTitle: "Snapshot A",
        snapshotBody: { type: "doc" },
      },
      {
        templateId,
        kind: "organization",
        organizationId: orgB,
        anchorItemId: g1,
        placement: "before",
        position: 100,
        snapshotTitle: "Snapshot B",
        snapshotBody: { type: "doc" },
      },
    ])
    .returning();
  a = snapshots[0].id;
  b = snapshots[1].id;
});
const entries = async () =>
  toOrder(
    await state.db
      .select()
      .from(schema.templateItems)
      .where(eq(schema.templateItems.templateId, templateId)),
  );
const order = (
  steps: NonNullable<Awaited<ReturnType<typeof loadWorkspace>>>["steps"],
) =>
  steps
    .filter((s) => s.kind === "global" || s.organizationId === orgA)
    .map((s) => ({
      itemId: s.id,
      position: s.position,
      anchorItemId: s.anchorItemId,
      placement: s.placement,
    }));
describe("workspace database behavior", () => {
  it("persists global ordering, retains other-org anchors, and restores a revision", async () => {
    const workspace = (await loadWorkspace(templateId))!;
    const original = await entries();
    const proposed = moveStep(workspace.steps, g1, g2, "after", orgA);
    await saveOrder(
      templateId,
      {
        organizationId: orgA,
        movedItemId: g1,
        expectedOrder: order(workspace.steps),
        proposedOrder: order(proposed),
      },
      "development-admin",
    );
    expect(
      (await loadWorkspace(templateId))!.steps.find((s) => s.id === g1)
        ?.position,
    ).toBe(200);
    expect((await entries()).find((s) => s.itemId === b)).toEqual(
      original.find((s) => s.itemId === b),
    );
    await restoreOrder(templateId, original, "development-admin");
    expect((await entries()).find((s) => s.itemId === g1)?.position).toBe(100);
    expect((await state.db.select().from(schema.revisions)).length).toBe(2);
  });
  it("rejects stale saves and rolls back updates and revision when audit insertion fails", async () => {
    const workspace = (await loadWorkspace(templateId))!;
    const baseline = order(workspace.steps);
    const proposed = order(moveStep(workspace.steps, g1, g2, "after", orgA));
    await client.exec(
      "CREATE FUNCTION fail_order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'template.order_changed' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_order BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_order_audit();",
    );
    try {
      await expect(
        saveOrder(
          templateId,
          {
            organizationId: orgA,
            movedItemId: g1,
            expectedOrder: baseline,
            proposedOrder: proposed,
          },
          "development-admin",
        ),
      ).rejects.toThrow();
      expect(order((await loadWorkspace(templateId))!.steps)).toEqual(baseline);
      expect(await state.db.select().from(schema.revisions)).toHaveLength(0);
    } finally {
      await client.exec(
        "DROP TRIGGER fail_order ON audit_events; DROP FUNCTION fail_order_audit();",
      );
    }
    await expect(
      saveOrder(
        templateId,
        {
          organizationId: orgA,
          movedItemId: g1,
          expectedOrder: baseline.map((s) => ({ ...s, position: 1 })),
          proposedOrder: proposed,
        },
        "development-admin",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("blocks viewers from order mutations and validates repeat-variable cardinality", async () => {
    state.role = "viewer";
    const response = await reorderRoute(
      new Request("http://localhost/api/templates/test/order", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: templateId }) },
    );
    expect(response.status).toBe(403);
    await expect(validateRepeatVariable(adId)).rejects.toThrow(
      "repeat_variable_must_be_active_list",
    );
  });
  it("shows missing anchors after removal and rejects order restoration with changed membership", async () => {
    const response = await removeEntry(
      new Request(`http://localhost/items?itemId=${g1}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: templateId }) },
    );
    expect(response.status).toBe(204);
    const context = await loadTemplateContext(templateId, orgA);
    expect(context?.issues).toContainEqual({
      code: "missing_anchor",
      itemId: a,
    });
    const all = await entries();
    await expect(
      restoreOrder(
        templateId,
        all.map((s) => ({
          itemId: s.itemId,
          position: s.position,
          anchorItemId: s.anchorItemId,
          placement: s.placement,
        })),
        "development-admin",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("propagates live global changes while snapshots remain unchanged and prevents source deletion", async () => {
    const response = await globalPatch(
      new Request("http://localhost/global", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated global" }),
      }),
      { params: Promise.resolve({ id: sourceId }) },
    );
    expect(response.status).toBe(200);
    const workspace = (await loadWorkspace(templateId))!;
    expect(workspace.steps.find((s) => s.id === g1)?.title).toBe(
      "Updated global",
    );
    expect(workspace.steps.find((s) => s.id === a)?.title).toBe("Snapshot A");
    expect(
      (
        await globalDelete(
          new Request("http://localhost/global", { method: "DELETE" }),
          { params: Promise.resolve({ id: sourceId }) },
        )
      ).status,
    ).toBe(409);
  });
  it("uses stored variable freshness and blocks only the affected organization", async () => {
    await state.db
      .update(schema.organizationVariableValues)
      .set({ syncedAt: new Date(Date.now() - 90000000) })
      .where(eq(schema.organizationVariableValues.organizationId, orgA));
    expect(
      (await loadTemplateContext(templateId, orgA))?.invalidVariables,
    ).toEqual(["org.ad_full_name"]);
    expect((await loadTemplateContext(templateId, orgB))?.valid).toBe(true);
  });
  it("restores a removed global entry and records recovery without deleting its source", async () => {
    await removeEntry(
      new Request(`http://localhost/items?itemId=${g1}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: templateId }) },
    );
    const [revision] = await state.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.entityId, g1));
    const result = await restoreRevision(
      new Request("http://localhost/restore", { method: "POST" }),
      { params: Promise.resolve({ id: revision.id }) },
    );
    expect(result.status).toBe(200);
    expect(
      (await loadWorkspace(templateId))!.steps.some((s) => s.id === g1),
    ).toBe(true);
    expect(
      (await loadTemplateContext(templateId, orgA))?.issues,
    ).not.toContainEqual({ code: "missing_anchor", itemId: a });
    expect(
      await state.db
        .select()
        .from(schema.globalSteps)
        .where(eq(schema.globalSteps.id, sourceId)),
    ).toHaveLength(1);
    expect(
      await state.db
        .select()
        .from(schema.revisions)
        .where(eq(schema.revisions.entityId, g1)),
    ).toHaveLength(2);
  });
  it("persists repetition on a snapshot without changing the global repeat setting", async () => {
    const [list] = await state.db
      .insert(schema.variableDefinitions)
      .values({
        key: "org.applications",
        label: "Applications",
        assetTypeId: "107505",
        assetTypeName: "Applications",
        cardinality: "list",
        selectedFields: [
          { sourceKey: "name", alias: "name", expectedKind: "Text" },
        ],
        validationRules: {},
      })
      .returning();
    const result = await snapshotPatch(
      new Request(`http://localhost/items?itemId=${a}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repeatVariableId: list.id }),
      }),
      { params: Promise.resolve({ id: templateId }) },
    );
    expect(result.status).toBe(200);
    const workspace = (await loadWorkspace(templateId))!;
    expect(workspace.steps.find((s) => s.id === a)?.repeat).toBe(
      "org.applications",
    );
    expect(
      workspace.steps.find((s) => s.id === g1)?.repeatVariableId,
    ).toBeNull();
  });
  it.each([
    {
      value: Array.from({ length: 1001 }, () => ({ name: "App" })),
      issue: "record_limit_exceeded",
    },
    {
      value: ["unapproved free-text fixture"],
      issue: "malformed_normalized_list",
    },
  ])("rejects unsafe stored lists: $issue", async ({ value, issue }) => {
    const [list] = await state.db
      .insert(schema.variableDefinitions)
      .values({
        key: "org.applications",
        label: "Applications",
        assetTypeId: "107505",
        assetTypeName: "Applications",
        cardinality: "list",
        selectedFields: [
          { sourceKey: "name", alias: "name", expectedKind: "Text" },
        ],
        validationRules: {},
      })
      .returning();
    await state.db.insert(schema.organizationVariableValues).values({
      organizationId: orgA,
      definitionId: list.id,
      value,
      status: "valid",
      syncedAt: new Date(),
    });
    await state.db
      .update(schema.templateItems)
      .set({ snapshotRepeatVariableId: list.id })
      .where(eq(schema.templateItems.id, a));
    const context = await loadTemplateContext(templateId, orgA);
    expect(context?.variables.find((v) => v.id === list.id)).toMatchObject({
      value: null,
      status: "invalid",
      issues: [issue],
    });
    expect(context?.valid).toBe(false);
  });
  it("projects only currently approved aliases into the variable context", async () => {
    const [list] = await state.db
      .insert(schema.variableDefinitions)
      .values({
        key: "org.applications",
        label: "Applications",
        assetTypeId: "107505",
        assetTypeName: "Applications",
        cardinality: "list",
        selectedFields: [
          { sourceKey: "name", alias: "name", expectedKind: "Text" },
        ],
        validationRules: {},
      })
      .returning();
    await state.db.insert(schema.organizationVariableValues).values({
      organizationId: orgA,
      definitionId: list.id,
      value: [
        {
          id: "1",
          name: "Approved app",
          removedAlias: "discard this fixture",
        },
      ],
      status: "invalid",
      syncedAt: new Date(),
    });
    const context = await loadTemplateContext(templateId, orgA);
    expect(context?.variables.find((v) => v.id === list.id)?.value).toEqual([
      { id: "1", name: "Approved app" },
    ]);
    expect(context?.valid).toBe(true); // Invalid unused variables do not block this template.
  });
});
