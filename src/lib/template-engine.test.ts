import { describe, expect, it } from "vitest";
import { mergeTemplateItems, renderTemplate, type RichNode, type TemplateItem } from "./template-engine";

const body = (text: string): RichNode => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const globals: TemplateItem[] = [
  { id: "g1", kind: "global", position: 10, title: "Domain {{org.ad_full_name}}", body: body("Start") },
  { id: "g2", kind: "global", position: 20, title: "Review {{item.name}}", body: body("Open {{item.name}}"), repeatVariableKey: "org.applications" },
];

describe("template engine", () => {
  it("anchors organization snapshots without mutating global order", () => {
    const snapshot: TemplateItem = { id: "o1", kind: "organization", organizationId: "org-1", anchorItemId: "g2", placement: "before", position: 1, title: "VPN", body: body("Configure") };
    expect(mergeTemplateItems([...globals, snapshot], "org-1").items.map((item) => item.id)).toEqual(["g1", "o1", "g2"]);
    expect(mergeTemplateItems([...globals, snapshot], "org-2").items.map((item) => item.id)).toEqual(["g1", "g2"]);
  });

  it("reports a removed anchor rather than silently relocating a snapshot", () => {
    const snapshot: TemplateItem = { id: "o1", kind: "organization", organizationId: "org-1", anchorItemId: "gone", placement: "after", position: 1, title: "VPN", body: body("Configure") };
    expect(mergeTemplateItems([...globals, snapshot], "org-1").issues).toEqual([{ code: "missing_anchor", itemId: "o1" }]);
  });

  it("resolves scalar variables and repeats whole steps for lists", () => {
    const rendered = renderTemplate(globals, "org-1", { org: { ad_full_name: "acme.local", applications: [{ name: "Adobe" }, { name: "M365" }] } });
    expect(rendered.valid).toBe(true);
    expect(rendered.steps.map((step) => step.title)).toEqual(["Domain acme.local", "Review Adobe", "Review M365"]);
  });
});
