import { describe, it, expect } from "vitest";
import {
  moveStep,
  visibleOrder,
  stepOrder,
  validateOrder,
} from "./template-order";
import type { WorkspaceStep } from "./workspace-types";
const row = (
  id: string,
  kind: "global" | "org",
  position: number,
  anchorItemId: string | null = null,
  placement: WorkspaceStep["placement"] = null,
  inherited = kind === "global",
): WorkspaceStep => ({
  id,
  templateId: inherited ? "parent" : "child",
  title: id,
  body: { type: "doc" },
  kind,
  inherited,
  position,
  organizationId: kind === "org" ? "org" : null,
  anchorItemId,
  placement,
  repeatVariableId: null,
  version: 1,
});
const rows = [
  row("g1", "global", 100),
  row("g2", "global", 200),
  row("local", "org", 100, "g1", "after"),
  row("start", "org", 100, null, "start"),
  row("end", "org", 100, null, "end"),
];
describe("owned and inherited ordering", () => {
  it("merges start/end additions around inherited anchors", () => {
    expect(visibleOrder(rows).map((step) => step.id)).toEqual([
      "start",
      "g1",
      "local",
      "g2",
      "end",
    ]);
  });
  it("carries local additions when the global parent order changes", () => {
    const parent = rows
      .filter((step) => step.kind === "global")
      .map((step) => ({ ...step, inherited: false }));
    const changed = moveStep(parent, "g1", "g2", "after");
    const combined = [
      ...changed.map((step) => ({ ...step, inherited: true })),
      ...rows.filter((step) => step.kind === "org"),
    ];
    expect(visibleOrder(combined).map((step) => step.id)).toEqual([
      "start",
      "g2",
      "g1",
      "local",
      "end",
    ]);
  });
  it("moves a local step into another inherited group or a boundary", () => {
    expect(
      moveStep(rows, "local", "g2", "before").find(
        (step) => step.id === "local",
      ),
    ).toMatchObject({ anchorItemId: "g2", placement: "before" });
    expect(
      moveStep(rows, "local", "end", "after").find(
        (step) => step.id === "local",
      ),
    ).toMatchObject({ anchorItemId: null, placement: "end" });
  });
  it("keeps orphaned additions visible and supports explicit repair", () => {
    const broken = rows.map((step) =>
      step.id === "local" ? { ...step, anchorItemId: "missing" } : step,
    );
    expect(visibleOrder(broken).at(-1)?.id).toBe("local");
    expect(
      moveStep(broken, "local", "start", "after").find(
        (step) => step.id === "local",
      )?.placement,
    ).toBe("start");
  });
  it("rejects inherited mutation, foreign/duplicate IDs, stale order, and invalid anchors", () => {
    const current = rows.map(stepOrder);
    expect(() =>
      validateOrder(current, current, current, "g1", "organization"),
    ).toThrow("inherited_step_read_only");
    expect(() =>
      validateOrder(
        current,
        current,
        current.slice(1),
        "local",
        "organization",
      ),
    ).toThrow("invalid_order_membership");
    expect(() =>
      validateOrder(
        current,
        current,
        [...current.slice(1), current[1]],
        "local",
        "organization",
      ),
    ).toThrow("invalid_order_membership");
    expect(() =>
      validateOrder(
        current,
        current.map((entry) => ({ ...entry, position: 0 })),
        current,
        "local",
        "organization",
      ),
    ).toThrow("order_changed_reload");
    expect(() =>
      validateOrder(
        current,
        current,
        current.map((entry) =>
          entry.itemId === "local"
            ? { ...entry, anchorItemId: "foreign" }
            : entry,
        ),
        "local",
        "organization",
      ),
    ).toThrow("invalid_anchor");
  });
});
