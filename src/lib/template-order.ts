export type OrderEntry = {
  itemId: string;
  position: number;
  anchorItemId: string | null;
  placement: "before" | "after" | null;
};
export type OrderItem = OrderEntry & {
  kind: "global" | "organization";
  organizationId: string | null;
};
export class OrderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const orderEntry = (item: OrderEntry): OrderEntry => ({
  itemId: item.itemId,
  position: item.position,
  anchorItemId: item.anchorItemId,
  placement: item.placement,
});
export function sameOrder(a: OrderEntry[], b: OrderEntry[]) {
  const normalize = (rows: OrderEntry[]) =>
    [...rows].sort((x, y) => x.itemId.localeCompare(y.itemId)).map(orderEntry);
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
export function validateOrder(
  current: OrderItem[],
  expected: OrderEntry[],
  proposed: OrderEntry[],
  movedItemId: string,
  organizationId: string | null,
) {
  const ids = current.map((row) => row.itemId).sort();
  for (const rows of [expected, proposed]) {
    if (
      new Set(rows.map((row) => row.itemId)).size !== rows.length ||
      JSON.stringify(rows.map((row) => row.itemId).sort()) !==
        JSON.stringify(ids)
    )
      throw new OrderError("invalid_order_membership");
  }
  if (!sameOrder(current, expected))
    throw new OrderError("order_changed_reload", 409);
  const moved = current.find((row) => row.itemId === movedItemId);
  if (!moved) throw new OrderError("moved_item_not_found");
  const next = new Map(proposed.map((row) => [row.itemId, row]));
  const globals = new Set(
    current.filter((row) => row.kind === "global").map((row) => row.itemId),
  );
  for (const row of current) {
    const change = next.get(row.itemId)!;
    if (row.kind === "global") {
      if (change.anchorItemId || change.placement)
        throw new OrderError("global_cannot_have_anchor");
      if (moved.kind !== "global" && change.position !== row.position)
        throw new OrderError("global_order_changed");
    } else {
      if (moved.kind === "global" && change.position !== row.position)
        throw new OrderError("organization_order_changed");
      const changedAnchor =
        change.anchorItemId !== row.anchorItemId ||
        change.placement !== row.placement;
      if (
        changedAnchor &&
        (row.itemId !== movedItemId ||
          moved.kind !== "organization" ||
          row.organizationId !== organizationId)
      )
        throw new OrderError("anchor_change_not_allowed");
      if (
        changedAnchor &&
        (!change.anchorItemId ||
          !globals.has(change.anchorItemId) ||
          !change.placement)
      )
        throw new OrderError("invalid_anchor", 409);
    }
  }
  const positions = current
    .filter((row) => row.kind === "global")
    .map((row) => next.get(row.itemId)!.position);
  if (new Set(positions).size !== positions.length)
    throw new OrderError("duplicate_global_position");
  return proposed;
}

export function visibleOrder<
  T extends {
    id: string;
    kind: "global" | "org";
    position: number;
    organizationId: string | null;
    anchorItemId: string | null;
    placement: "before" | "after" | null;
  },
>(steps: T[], organizationId: string | null) {
  const globals = steps
    .filter((s) => s.kind === "global")
    .sort((a, b) => a.position - b.position);
  const org = steps.filter(
    (s) => s.kind === "org" && s.organizationId === organizationId,
  );
  return globals
    .flatMap((g) => [
      ...org
        .filter((s) => s.anchorItemId === g.id && s.placement === "before")
        .sort((a, b) => a.position - b.position),
      g,
      ...org
        .filter((s) => s.anchorItemId === g.id && s.placement === "after")
        .sort((a, b) => a.position - b.position),
    ])
    .concat(
      org
        .filter(
          (s) =>
            !s.anchorItemId ||
            !s.placement ||
            !globals.some((g) => g.id === s.anchorItemId),
        )
        .sort((a, b) => a.position - b.position),
    );
}

export function moveStep<
  T extends {
    id: string;
    kind: "global" | "org";
    position: number;
    organizationId: string | null;
    anchorItemId: string | null;
    placement: "before" | "after" | null;
  },
>(
  steps: T[],
  movedId: string,
  targetId: string,
  side: "before" | "after",
  organizationId: string | null,
): T[] {
  const moved = steps.find((s) => s.id === movedId),
    target = steps.find((s) => s.id === targetId);
  if (!moved || !target || movedId === targetId) return steps;
  if (moved.kind === "global") {
    const anchorId = target.kind === "global" ? target.id : target.anchorItemId;
    if (!anchorId || anchorId === moved.id) return steps;
    const globals = steps
      .filter((s) => s.kind === "global")
      .sort((a, b) => a.position - b.position)
      .filter((s) => s.id !== moved.id);
    const index = globals.findIndex((s) => s.id === anchorId);
    if (index < 0) return steps;
    globals.splice(index + (side === "after" ? 1 : 0), 0, moved);
    const positions = new Map(globals.map((s, i) => [s.id, (i + 1) * 100]));
    return steps.map((s) =>
      s.kind === "global" ? { ...s, position: positions.get(s.id)! } : s,
    );
  }
  if (moved.organizationId !== organizationId) return steps;
  const anchorItemId =
    target.kind === "global" ? target.id : target.anchorItemId;
  const placement = target.kind === "global" ? side : target.placement;
  if (
    !anchorItemId ||
    !placement ||
    !steps.some((s) => s.id === anchorItemId && s.kind === "global")
  )
    return steps;
  const bucket = steps
    .filter(
      (s) =>
        s.kind === "org" &&
        s.organizationId === organizationId &&
        s.anchorItemId === anchorItemId &&
        s.placement === placement &&
        s.id !== moved.id,
    )
    .sort((a, b) => a.position - b.position);
  const index =
    target.kind === "global"
      ? side === "before"
        ? bucket.length
        : 0
      : Math.max(
          0,
          bucket.findIndex((s) => s.id === target.id),
        ) + (side === "after" ? 1 : 0);
  bucket.splice(index, 0, { ...moved, anchorItemId, placement });
  const updates = new Map(
    bucket.map((s, i) => [s.id, { ...s, position: (i + 1) * 100 }]),
  );
  return steps.map((s) => updates.get(s.id) ?? s);
}
