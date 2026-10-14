// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./workspace-ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

const dialogMethods = ["showModal", "close"] as const;
const originals = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dialogMethods.forEach((name, index) => {
    if (originals[index]) Object.defineProperty(HTMLDialogElement.prototype, name, originals[index]!);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

describe("shared modal positioning", () => {
  it("explicitly centers the native modal despite the global margin reset", () => {
    const { unmount } = render(
      <Modal title="Edit template details" onClose={vi.fn()}>
        <label>Name<input defaultValue="Test template" /></label>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit template details" });
    for (const token of ["fixed", "inset-0", "m-auto", "h-fit"])
      expect(dialog.classList.contains(token)).toBe(true);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Test template");
    unmount();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
  });

  it("bounds tall dialogs to the dynamic viewport and allows their contents to scroll", () => {
    render(<Modal title="Preview" onClose={vi.fn()}><p>Checklist preview</p></Modal>);
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    for (const token of ["max-h-[90dvh]", "w-[min(92vw,760px)]", "overflow-y-auto"])
      expect(dialog.classList.contains(token)).toBe(true);
  });

  it("preserves the close button and native Escape cancellation", () => {
    const onClose = vi.fn();
    render(<Modal title="Details" onClose={onClose}><p>Template details</p></Modal>);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
