// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionMenu } from "./workspace-ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

let top = 540;
beforeEach(() => {
  top = 540;
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu"
      ? { width: 208, height: 200 } as DOMRect
      : { top, bottom: top + 32, right: 792, left: 760, width: 32, height: 32 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  const action = vi.fn();
  const result = render(
    <section data-testid="clipping-card" style={{ overflow: "hidden", transform: "translateY(0)" }}>
      <ActionMenu label="Step actions" actions={[
        { label: "Move up", disabled: true },
        { label: "Move down", disabled: true },
        { label: "Step history", onClick: action },
        { label: "Remove step", onClick: action, danger: true },
      ]} />
    </section>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Step actions" }));
  return { ...result, action };
}

describe("action menu clipping regression", () => {
  it("renders the entire menu outside clipping and transformed ancestors", () => {
    const { getByTestId } = fixture();
    const menu = screen.getByRole("menu", { name: "Step actions" });
    expect(menu.parentElement).toBe(document.body);
    expect(getByTestId("clipping-card").contains(menu)).toBe(false);
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    expect(menu.style.top).toBe("336px");
    expect(menu.style.visibility).toBe("visible");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Step history" }));
  });
  it("repositions on ancestor scrolling and viewport resizing", () => {
    const { getByTestId } = fixture();
    top = 100;
    fireEvent.scroll(getByTestId("clipping-card"));
    expect(screen.getByRole("menu").style.top).toBe("136px");
    vi.stubGlobal("innerHeight", 200);
    fireEvent.resize(window);
    expect(screen.getByRole("menu").style.maxHeight).toBe("88px");
    expect(screen.getByRole("menu").style.top).toBe("8px");
  });
  it("does not dismiss on a pointer press inside the portaled menu, and executes its action", () => {
    const { action } = fixture();
    const item = screen.getByRole("menuitem", { name: "Remove step" });
    fireEvent.pointerDown(item);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.click(item);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Step actions" }));
  });
  it("keeps keyboard navigation, skips disabled items, and restores focus on Escape", () => {
    fixture();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Remove step" }));
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Step history" }));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Step actions" }));
  });
  it("dismisses on outside clicks and Tab", () => {
    fixture();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Step actions" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
