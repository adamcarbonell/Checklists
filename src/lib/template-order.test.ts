import { describe, it, expect } from "vitest";
import {
  moveStep,
  visibleOrder,
  validateOrder,
  type OrderItem,
} from "./template-order";
import type { WorkspaceStep } from "./workspace-types";
const step = (
  id: string,
  kind: "global" | "org",
  position: number,
  organizationId: string | null = null,
  anchorItemId: string | null = null,
  placement: "before" | "after" | null = null,
): WorkspaceStep => ({
  id,
  sourceId: id,
  title: id,
  body: { type: "doc" },
  kind,
  position,
  organizationId,
  anchorItemId,
  placement,
  repeatVariableId: null,
});
const rows = [
  step("g1", "global", 100),
  step("g2", "global", 200),
  step("a", "org", 100, "org-a", "g1", "after"),
  step("b", "org", 100, "org-b", "g1", "before"),
];
const entries = (steps: WorkspaceStep[]): OrderItem[] =>
  steps.map((s) => ({
    itemId: s.id,
    kind: s.kind === "global" ? "global" : "organization",
    organizationId: s.organizationId,
    position: s.position,
    anchorItemId: s.anchorItemId,
    placement: s.placement,
  }));
describe("template ordering", () => {
  it("moves a global block and preserves every organization anchor", () => {
    const result = moveStep(rows, "g1", "g2", "after", "org-a");
    expect(visibleOrder(result, "org-a").map((s) => s.id)).toEqual([
      "g2",
      "g1",
      "a",
    ]);
    expect(visibleOrder(result, "org-b").map((s) => s.id)).toEqual([
      "g2",
      "b",
      "g1",
    ]);
    expect(result.find((s) => s.id === "b")).toEqual(rows[3]);
  });
  it("reanchors only the dragged organization step", () => {
    const result = moveStep(rows, "a", "g2", "before", "org-a");
    expect(visibleOrder(result, "org-a").map((s) => s.id)).toEqual([
      "g1",
      "a",
      "g2",
    ]);
    expect(result.find((s) => s.id === "a")).toMatchObject({
      anchorItemId: "g2",
      placement: "before",
    });
    expect(result.find((s) => s.id === "b")).toEqual(rows[3]);
  });
  it("keeps orphaned snapshots visible and permits explicit repair", () => {
    const broken = [
      ...rows,
      step("lost", "org", 200, "org-a", "gone", "after"),
    ];
    expect(visibleOrder(broken, "org-a").at(-1)?.id).toBe("lost");
    expect(
      moveStep(broken, "lost", "g2", "after", "org-a").find(
        (s) => s.id === "lost",
      )?.anchorItemId,
    ).toBe("g2");
  });
  it("rejects stale order, duplicate IDs, foreign IDs, and anchor changes during a global move", () => {
    const current = entries(
      rows.filter((s) => s.kind === "global" || s.organizationId === "org-a"),
    );
    expect(() =>
      validateOrder(
        current,
        current.map((s) => ({ ...s, position: 0 })),
        current,
        "g1",
        "org-a",
      ),
    ).toThrow("order_changed_reload");
    expect(() =>
      validateOrder(
        current,
        current,
        [current[0], current[0], current[2]],
        "g1",
        "org-a",
      ),
    ).toThrow("invalid_order_membership");
    expect(() =>
      validateOrder(
        current,
        current,
        current.map((s) =>
          s.itemId === "a" ? { ...s, anchorItemId: "g2" } : s,
        ),
        "g1",
        "org-a",
      ),
    ).toThrow("anchor_change_not_allowed");
    expect(() =>
      validateOrder(
        current,
        current,
        current.map((s) =>
          s.itemId === "a" ? { ...s, anchorItemId: "foreign" } : s,
        ),
        "a",
        "org-a",
      ),
    ).toThrow("invalid_anchor");
  });
});
