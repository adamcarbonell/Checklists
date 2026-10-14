type Bounds = { top: number; bottom: number; right: number };
type Viewport = { left: number; top: number; width: number; height: number };

export function menuPosition(
  anchor: Bounds,
  menu: { width: number; height: number },
  viewport: Viewport,
  preferred: "up" | "down",
) {
  const margin = 8, gap = 4;
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(menu.width, maxWidth);
  const above = Math.max(0, anchor.top - viewport.top - gap - margin);
  const below = Math.max(0, viewport.top + viewport.height - anchor.bottom - gap - margin);
  const up = preferred === "up"
    ? above >= menu.height || above >= below
    : below < menu.height && above > below;
  const maxHeight = Math.min(up ? above : below, Math.max(0, viewport.height - margin * 2));
  const height = Math.min(menu.height, maxHeight);
  return {
    left: Math.max(viewport.left + margin, Math.min(anchor.right - width, viewport.left + viewport.width - width - margin)),
    top: Math.max(viewport.top + margin, Math.min(up ? anchor.top - gap - height : anchor.bottom + gap, viewport.top + viewport.height - height - margin)),
    maxWidth,
    maxHeight,
  };
}
