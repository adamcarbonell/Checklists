import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "@/db/client";
const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock("@/db/client", () => ({
  hasDatabase: () => !!state.db,
  getDatabase: () => state.db,
}));
import { GET } from "@/app/api/health/ready/route";

describe("schema-aware readiness", () => {
  it("refuses an absent database without exposing connection details", async () => {
    state.db = null;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      reason: "database_not_configured",
    });
  });
  it("does not mark the redesigned image ready against the old schema", async () => {
    const client = new PGlite();
    try {
      state.db = drizzle(client) as unknown as Database;
      await client.exec(
        await readFile("drizzle/0000_fixed_marten_broadcloak.sql", "utf8"),
      );
      const old = await GET();
      expect(old.status).toBe(503);
      expect(await old.json()).toEqual({
        status: "not_ready",
        reason: "database_or_schema_unavailable",
      });
      await client.exec(
        await readFile("drizzle/0001_template_execution_redesign.sql", "utf8"),
      );
      const current = await GET();
      expect(current.status).toBe(200);
      expect(await current.json()).toEqual({ status: "ready" });
    } finally {
      state.db = null;
      await client.close();
    }
  }, 30000);
});
