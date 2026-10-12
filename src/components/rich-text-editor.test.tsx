// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ setLink: vi.fn(), unsetLink: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@tiptap/react", () => {
  const chain = {
    focus: () => chain,
    extendMarkRange: () => chain,
    setLink: (value: unknown) => {
      mocks.setLink(value);
      return chain;
    },
    unsetLink: () => {
      mocks.unsetLink();
      return chain;
    },
    run: () => true,
  };
  const editor = {
    isEditable: true,
    isActive: () => false,
    getAttributes: () => ({}),
    getJSON: () => ({ type: "doc" }),
    chain: () => chain,
    commands: { setContent: vi.fn() },
  };
  return { useEditor: () => editor, EditorContent: () => <div>Editor</div> };
});
import { RichTextEditor } from "./rich-text-editor";
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);
it("edits links with an in-page form rather than a native browser prompt", async () => {
  render(
    <RichTextEditor
      value={{ type: "doc" }}
      onChange={vi.fn()}
      onInsertVariable={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Link" }));
  expect(await screen.findByRole("dialog", { name: "Edit link" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Link URL"), {
    target: { value: "https://example.test/help" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.setLink).toHaveBeenCalledWith({
      href: "https://example.test/help",
    }),
  );
});
it("rejects unsafe link schemes and allows removing a link", async () => {
  render(
    <RichTextEditor
      value={{ type: "doc" }}
      onChange={vi.fn()}
      onInsertVariable={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Link" }));
  fireEvent.change(screen.getByLabelText("Link URL"), {
    target: { value: "javascript:alert(1)" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(mocks.setLink).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Link URL"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.unsetLink).toHaveBeenCalledOnce());
});
