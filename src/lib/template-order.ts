import type { Placement, WorkspaceStep } from "./workspace-types";
import type { TemplateBranch } from "./conditional-types";
import { buildTemplateTree, workspaceItems, type TreeNode } from "./conditional-tree";
export type OrderEntry = {
  itemId: string;
  position: number;
  anchorItemId: string | null;
  placement: Placement | null;
  parentBranchId?: string | null;
};
export type OrderItem = OrderEntry & { owned: boolean };
export class OrderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const orderEntry = (row: OrderEntry): OrderEntry => ({
  itemId: row.itemId,
  position: row.position,
  anchorItemId: row.anchorItemId,
  placement: row.placement,
  parentBranchId: row.parentBranchId ?? null,
});
export const stepOrder = (step: WorkspaceStep): OrderItem => ({
  ...orderEntry({
    itemId: step.id,
    position: step.position,
    anchorItemId: step.anchorItemId,
    placement: step.placement,
    parentBranchId: step.parentBranchId ?? null,
  }),
  owned: !step.inherited,
});
export function sameOrder(a: OrderEntry[], b: OrderEntry[]) {
  const normalize = (rows: OrderEntry[]) =>
    [...rows].sort((x, y) => x.itemId.localeCompare(y.itemId)).map(orderEntry);
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
export function validPlacement(
  entry: OrderEntry,
  anchors: Set<string>,
  scope: "global" | "organization",
) {
  if (scope === "global") return !entry.anchorItemId && !entry.placement;
  if (entry.placement === "start" || entry.placement === "end")
    return !entry.anchorItemId;
  return (
    !!entry.anchorItemId &&
    anchors.has(entry.anchorItemId) &&
    (entry.placement === "before" || entry.placement === "after")
  );
}
export function validateOrder(
  current: OrderItem[],
  expected: OrderEntry[],
  proposed: OrderEntry[],
  movedId: string,
  scope: "global" | "organization",
) {
  const ids = current.map((row) => row.itemId).sort();
  for (const rows of [expected, proposed])
    if (
      new Set(rows.map((row) => row.itemId)).size !== rows.length ||
      JSON.stringify(rows.map((row) => row.itemId).sort()) !==
        JSON.stringify(ids)
    )
      throw new OrderError("invalid_order_membership");
  if (!sameOrder(current, expected))
    throw new OrderError("order_changed_reload", 409);
  const moved = current.find((row) => row.itemId === movedId);
  if (!moved) throw new OrderError("moved_item_not_found");
  if (!moved.owned) throw new OrderError("inherited_step_read_only", 403);
  const anchors = new Set(
      current.filter((row) => !row.owned).map((row) => row.itemId),
    ),
    next = new Map(proposed.map((row) => [row.itemId, row]));
  const buckets = new Map<string, Set<number>>();
  for (const row of current) {
    const change = next.get(row.itemId)!;
    if (!row.owned) {
      if (!sameOrder([row], [change]))
        throw new OrderError("inherited_step_read_only", 403);
      continue;
    }
    const reanchored =
      change.anchorItemId !== row.anchorItemId ||
      change.placement !== row.placement || (change.parentBranchId ?? null) !== (row.parentBranchId ?? null);
    if (reanchored && row.itemId !== movedId)
      throw new OrderError("anchor_change_not_allowed");
    if (
      (scope === "global" || reanchored || row.itemId === movedId) &&
      !validPlacement(change, anchors, scope)
    )
      throw new OrderError("invalid_anchor", 409);
    const bucket =
      scope === "global"
        ? "global:" + (change.parentBranchId ?? "root")
        : change.placement + ":" + change.anchorItemId + ":" + (change.parentBranchId ?? "root");
    const positions = buckets.get(bucket) ?? new Set<number>();
    if (positions.has(change.position))
      throw new OrderError("duplicate_position");
    positions.add(change.position);
    buckets.set(bucket, positions);
  }
}
export function visibleOrder(steps: WorkspaceStep[], branches?: TemplateBranch[]) {
  if (branches?.length) {
    const tree = buildTemplateTree(workspaceItems(steps, steps.find((row) => row.organizationId)?.organizationId ?? ""), branches, steps.find((row) => row.organizationId)?.organizationId ?? "");
    const flatten = (nodes: TreeNode[]): string[] => nodes.flatMap((node) => [node.item.id, ...node.branches.flatMap((branch) => flatten(branch.children))]);
    return [...flatten(tree.roots), ...tree.unplaced.map((node) => node.id)].map((id) => steps.find((row) => row.id === id)!);
  }
  const base = steps
      .filter((step) => step.kind === "global")
      .sort((a, b) => a.position - b.position),
    local = steps.filter((step) => step.kind === "org");
  const group = (placement: Placement, anchorItemId: string | null) =>
    local
      .filter(
        (step) =>
          step.placement === placement && step.anchorItemId === anchorItemId,
      )
      .sort((a, b) => a.position - b.position);
  const ordered = [
    ...group("start", null),
    ...base.flatMap((step) => [
      ...group("before", step.id),
      step,
      ...group("after", step.id),
    ]),
    ...group("end", null),
  ];
  return [
    ...ordered,
    ...local
      .filter((step) => !ordered.some((entry) => entry.id === step.id))
      .sort((a, b) => a.position - b.position),
  ];
}
export function moveStep(
  steps: WorkspaceStep[],
  movedId: string,
  targetId: string,
  side: "before" | "after",
  branches: TemplateBranch[] = [],
) {
  const moved = steps.find((step) => step.id === movedId),
    target = steps.find((step) => step.id === targetId);
  if (!moved || moved.inherited || movedId === targetId) return steps;
  if (branches.length || targetId.startsWith("branch:") || targetId === "start" || targetId === "end") {
    let parentBranchId: string | null = null, placement: Placement | null = null, anchorItemId: string | null = null;
    const branchTarget = /^branch:([^:]+):(start|end)$/.exec(targetId);
    if (branchTarget) {
      if (!branches.some((branch) => branch.id === branchTarget[1])) return steps;
      parentBranchId = branchTarget[1];
      placement = moved.kind === "org" ? branchTarget[2] as Placement : null;
    } else if (targetId === "start" || targetId === "end") placement = moved.kind === "org" ? targetId : null;
    else if (!target) return steps;
    else if (moved.kind === "org" && target.inherited) {
      placement = side; anchorItemId = target.id;
    } else {
      if (moved.kind !== target.kind || target.inherited) return steps;
      parentBranchId = target.parentBranchId ?? null;
      placement = target.placement; anchorItemId = target.anchorItemId;
    }
    // Moving a group into any descendant's branch would create a cycle.
    let branch = parentBranchId;
    const visited = new Set<string>();
    while (branch && !visited.has(branch)) {
      visited.add(branch);
      const owner = steps.find((row) => row.id === branches.find((row) => row.id === branch)?.groupItemId);
      if (owner?.id === movedId) return steps;
      branch = owner?.parentBranchId ?? (owner?.anchorItemId ? steps.find((row) => row.id === owner.anchorItemId)?.parentBranchId : null) ?? null;
    }
    const siblings = steps.filter((row) => row.id !== movedId && !row.inherited && row.kind === moved.kind &&
      (row.parentBranchId ?? null) === parentBranchId && row.placement === placement && row.anchorItemId === anchorItemId).sort((a,b) => a.position - b.position);
    const index = target && siblings.some((row) => row.id === target.id) ? siblings.findIndex((row) => row.id === target.id) + (side === "after" ? 1 : 0) :
      branchTarget?.[2] === "start" || targetId === "start" ? 0 : side === "after" && anchorItemId ? 0 : siblings.length;
    siblings.splice(index, 0, { ...moved, parentBranchId, placement, anchorItemId });
    const updates = new Map(siblings.map((row,index) => [row.id, { ...row, position: (index+1)*100 }]));
    return steps.map((row) => updates.get(row.id) ?? row);
  }
  if (moved.kind === "global") {
    if (!target || target.kind !== "global") return steps;
    const rows = steps
      .filter((step) => step.kind === "global" && step.id !== movedId)
      .sort((a, b) => a.position - b.position);
    const index = rows.findIndex((step) => step.id === targetId);
    if (index < 0) return steps;
    rows.splice(index + (side === "after" ? 1 : 0), 0, moved);
    const positions = new Map(
      rows.map((step, index) => [step.id, (index + 1) * 100]),
    );
    return steps.map((step) =>
      positions.has(step.id)
        ? { ...step, position: positions.get(step.id)! }
        : step,
    );
  }
  let placement: Placement | null, anchorItemId: string | null;
  if (targetId === "start" || targetId === "end") {
    placement = targetId;
    anchorItemId = null;
  } else if (target?.kind === "global") {
    placement = side;
    anchorItemId = target.id;
  } else {
    placement = target?.placement ?? null;
    anchorItemId = target?.anchorItemId ?? null;
  }
  if (
    !placement ||
    ((placement === "before" || placement === "after") &&
      !steps.some((step) => step.kind === "global" && step.id === anchorItemId))
  )
    return steps;
  const group = steps
    .filter(
      (step) =>
        step.kind === "org" &&
        step.id !== movedId &&
        step.placement === placement &&
        step.anchorItemId === anchorItemId,
    )
    .sort((a, b) => a.position - b.position);
  const index =
    target?.kind === "org"
      ? group.findIndex((step) => step.id === targetId) +
        (side === "after" ? 1 : 0)
      : side === "before"
        ? group.length
        : 0;
  group.splice(Math.max(0, index), 0, { ...moved, placement, anchorItemId });
  const updates = new Map(
    group.map((step, index) => [
      step.id,
      { ...step, position: (index + 1) * 100 },
    ]),
  );
  return steps.map((step) => updates.get(step.id) ?? step);
}
