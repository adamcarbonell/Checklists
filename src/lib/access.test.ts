import { describe, expect, it } from "vitest";
import { roleAllows } from "./roles";

describe("role boundaries", () => {
  it("keeps viewers read-only", () => { expect(roleAllows("viewer", "viewer")).toBe(true); expect(roleAllows("viewer", "editor")).toBe(false); });
  it("lets editors author but not administer", () => { expect(roleAllows("editor", "viewer")).toBe(true); expect(roleAllows("editor", "editor")).toBe(true); expect(roleAllows("editor", "admin")).toBe(false); });
  it("lets administrators perform every role", () => { expect(roleAllows("admin", "viewer")).toBe(true); expect(roleAllows("admin", "editor")).toBe(true); expect(roleAllows("admin", "admin")).toBe(true); });
});
