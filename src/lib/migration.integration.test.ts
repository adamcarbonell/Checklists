import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";
import { requireMigrationConfirmation } from "./migration-guard";
import { seedVariableDefinitions } from "./seed";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { applyMigrations } from "./migration-runner";
describe("redesign cutover safety", () => {
  it("adds conditional schema without changing existing content, progress, mappings, or history", async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as Database;
      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      await applyMigrations(db,migrations.slice(0,2),["--confirm-template-reset"]);
      const actor = "00000000-0000-4000-8000-000000000001", org = "00000000-0000-4000-8000-000000000002";
      const parent = "00000000-0000-4000-8000-000000000003", child = "00000000-0000-4000-8000-000000000004", step = "00000000-0000-4000-8000-000000000005";
      const run = "00000000-0000-4000-8000-000000000006";
      await client.exec(`INSERT INTO users(id,entra_subject,email,name,role) VALUES ('${actor}','migration','test@example.test','Test','viewer');
        INSERT INTO organizations(id,itglue_id,name) VALUES ('${org}','1','Client');
        INSERT INTO templates(id,name,scope) VALUES ('${parent}','Existing parent','global');
        INSERT INTO templates(id,name,scope,organization_id,global_template_id) VALUES ('${child}','Existing child','organization','${org}','${parent}');
        INSERT INTO template_items(id,template_id,title,body,position,version) VALUES ('${step}','${parent}','Keep spaces  ','{"type":"doc"}',100,7);
        INSERT INTO revisions(entity_type,entity_id,snapshot,action) VALUES ('template_item','${step}','{"title":"Before","position":100}','update');
        INSERT INTO checklists(id,name,organization_id,organization_name,template_id,template_name,global_template_id,template_version,global_template_version,variable_snapshot,creation_key,created_by)
          VALUES ('${run}','Frozen','${org}','Client','${child}','Existing child','${parent}',1,1,'{"org.test":{"value":"kept"}}','00000000-0000-4000-8000-000000000007','${actor}');
        INSERT INTO checklist_steps(checklist_id,source_item_id,position,title,body,status,notes,version) VALUES ('${run}','${step}',1,'Frozen instructions','{"type":"doc"}','completed','Keep notes',3);
        INSERT INTO checklist_activity(checklist_id,actor_user_id,event,changes) VALUES ('${run}','${actor}','created','{"stepCount":1}');`);
      await seedVariableDefinitions(db);
      const tables=["templates","revisions","checklists","checklist_steps","checklist_activity","variable_definitions","organizations","users","audit_events"];
      const before=await Promise.all(tables.map(async(table)=>(await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows));
      expect(await applyMigrations(db,migrations,[])).toBe(1);
      expect(await applyMigrations(db,migrations,[])).toBe(0);
      expect(await Promise.all(tables.map(async(table)=>(await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows))).toEqual(before);
      expect(await db.select().from(schema.templateItems)).toMatchObject([{id:step,title:"Keep spaces  ",version:7,nodeType:"step",parentBranchId:null}]);
      expect(await db.select().from(schema.templateBranches)).toEqual([]);
    } finally { await client.close(); }
  },30000);
  it("journals the reset atomically and does not replay it on a later release", async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as Database;
      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      expect(await applyMigrations(db, migrations.slice(0, 1), [])).toBe(1);
      await client.exec("INSERT INTO templates (name) VALUES ('Legacy test')");
      await expect(applyMigrations(db, migrations, [])).rejects.toThrow(
        "reset is pending",
      );
      expect((await client.query("SELECT name FROM templates")).rows).toEqual([
        { name: "Legacy test" },
      ]);
      expect(
        await applyMigrations(db, migrations, ["--confirm-template-reset"]),
      ).toBe(2);
      await db
        .insert(schema.templates)
        .values({ name: "New template", scope: "global" });
      expect(await applyMigrations(db, migrations, [])).toBe(0);
      expect(await db.select().from(schema.templates)).toMatchObject([
        { name: "New template" },
      ]);
      expect(
        (await client.query("SELECT * FROM public.__drizzle_migrations")).rows,
      ).toHaveLength(3);
    } finally {
      await client.close();
    }
  }, 30000);
  it("requires explicit confirmation only when the destructive reset is pending", async () => {
    const reset = await readFile(
      "drizzle/0001_template_execution_redesign.sql",
      "utf8",
    );
    expect(() => requireMigrationConfirmation([reset], [])).toThrow(
      "reset is pending",
    );
    expect(() =>
      requireMigrationConfirmation([reset], ["--confirm-template-reset"]),
    ).not.toThrow();
    expect(() => requireMigrationConfirmation(["select 1"], [])).not.toThrow();
  });
  it("clears only legacy template data and preserves approved organization data and security history", async () => {
    const client = new PGlite();
    try {
      await client.exec(
        await readFile("drizzle/0000_fixed_marten_broadcloak.sql", "utf8"),
      );
      await client.exec(`INSERT INTO users (id,entra_subject,email,name,role) VALUES ('00000000-0000-4000-8000-000000000001','migration-fixture','fixture@example.test','Fixture','editor');
        INSERT INTO organizations (id,itglue_id,name) VALUES ('00000000-0000-4000-8000-000000000002','10','Preserved client');
        INSERT INTO variable_definitions (id,key,label,asset_type_id,asset_type_name,cardinality,selected_fields,validation_rules,enabled) VALUES ('00000000-0000-4000-8000-000000000003','org.ad_full_name','Approved AD','107504','AD','scalar','[{"sourceKey":"approved-custom-field","alias":"value","expectedKind":"Text"}]','{"exactRecords":1}',false);
        INSERT INTO organization_variable_values (organization_id,definition_id,value,status,synced_at) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','"preserved.local"','valid',now());
        INSERT INTO sync_runs (organization_id,trigger,status) VALUES ('00000000-0000-4000-8000-000000000002','fixture','valid');
        INSERT INTO audit_events (event_type,details) VALUES ('security.fixture','{}');
        INSERT INTO templates (id,name) VALUES ('00000000-0000-4000-8000-000000000004','Legacy template');
        INSERT INTO global_steps (id,title,body) VALUES ('00000000-0000-4000-8000-000000000005','Legacy step','{"type":"doc"}');
        INSERT INTO template_items (template_id,kind,global_step_id,position) VALUES ('00000000-0000-4000-8000-000000000004','global','00000000-0000-4000-8000-000000000005',100);
        INSERT INTO revisions (entity_type,entity_id,snapshot,action) VALUES ('template','00000000-0000-4000-8000-000000000004','{}','update');`);
      const migration = await readFile(
        "drizzle/0001_template_execution_redesign.sql",
        "utf8",
      );
      await client.exec("BEGIN;" + migration + "COMMIT;");
      await client.exec(await readFile("drizzle/0002_conditional_groups.sql", "utf8"));
      const db = drizzle(client, { schema }) as unknown as Database;
      await seedVariableDefinitions(db);
      await seedVariableDefinitions(db);
      expect(await db.select().from(schema.templates)).toHaveLength(0);
      expect(await db.select().from(schema.templateItems)).toHaveLength(0);
      expect(await db.select().from(schema.revisions)).toHaveLength(0);
      expect(await db.select().from(schema.users)).toMatchObject([
        { role: "editor", email: "fixture@example.test" },
      ]);
      expect(await db.select().from(schema.organizations)).toMatchObject([
        { name: "Preserved client" },
      ]);
      const definitions = await db.select().from(schema.variableDefinitions);
      expect(definitions).toHaveLength(2);
      expect(
        definitions.find((definition) => definition.key === "org.ad_full_name"),
      ).toMatchObject({
        enabled: false,
        selectedFields: [{ sourceKey: "approved-custom-field" }],
      });
      expect(
        await db.select().from(schema.organizationVariableValues),
      ).toMatchObject([{ value: "preserved.local", status: "valid" }]);
      expect(await db.select().from(schema.syncRuns)).toHaveLength(1);
      expect(
        (await db.select().from(schema.auditEvents)).map(
          (event) => event.eventType,
        ),
      ).toEqual(["security.fixture", "templates.redesign_reset"]);
      // A recorded migration is not replayed on later releases; seeding is independently idempotent.
      await db
        .insert(schema.templates)
        .values({ name: "New standard", scope: "global" });
      await seedVariableDefinitions(db);
      expect(await db.select().from(schema.templates)).toHaveLength(1);
    } finally {
      await client.close();
    }
  }, 30000);
});
