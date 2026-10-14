import { describe, expect, it } from "vitest";
import { menuPosition } from "./menu-position";

const viewport = { left: 0, top: 0, width: 800, height: 600 };
const menu = { width: 208, height: 200 };

describe("floating action menu placement", () => {
  it("opens below when there is room", () => {
    expect(menuPosition({ top: 100, bottom: 132, right: 700 }, menu, viewport, "down"))
      .toMatchObject({ top: 136, left: 492, maxHeight: 456 });
  });
  it("flips above a final row near the bottom of the viewport", () => {
    expect(menuPosition({ top: 540, bottom: 572, right: 792 }, menu, viewport, "down"))
      .toMatchObject({ top: 336, left: 584 });
  });
  it("honors upward placement and flips down if the trigger is at the top", () => {
    expect(menuPosition({ top: 400, bottom: 432, right: 700 }, menu, viewport, "up").top).toBe(196);
    expect(menuPosition({ top: 12, bottom: 44, right: 700 }, menu, viewport, "up").top).toBe(48);
  });
  it("clamps both horizontal edges and handles a narrower viewport than the menu", () => {
    expect(menuPosition({ top: 100, bottom: 132, right: 30 }, menu, viewport, "down").left).toBe(8);
    expect(menuPosition({ top: 100, bottom: 132, right: 900 }, menu, viewport, "down").left).toBe(584);
    expect(menuPosition({ top: 10, bottom: 42, right: 100 }, menu, { ...viewport, width: 160 }, "down"))
      .toMatchObject({ left: 8, maxWidth: 144 });
  });
  it("constrains long menus to the available space so they can scroll", () => {
    expect(menuPosition({ top: 300, bottom: 332, right: 700 }, { ...menu, height: 1000 }, viewport, "down"))
      .toMatchObject({ top: 8, maxHeight: 288 });
  });
  it("accounts for a zoomed or keyboard-reduced visual viewport", () => {
    expect(menuPosition({ top: 300, bottom: 332, right: 700 }, menu, { left: 50, top: 100, width: 400, height: 300 }, "down"))
      .toMatchObject({ top: 108, left: 234, maxHeight: 188 });
  });
});
