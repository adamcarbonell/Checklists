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

  it("resolves qualified list fields and item aliases in titles and rich text without mutating the source", () => {
    const values = { org: { ad_full_name: "acme.local", applications: [
      { name: "Photoshop", version: "Latest", count: 0, enabled: false },
      { name: "Acrobat", version: "2026", count: 1, enabled: true },
    ] } };
    const before = structuredClone(values);
    const repeated: TemplateItem = { ...globals[1], title: "Install {{org.applications.name}} {{item.version}}", body: body("{{org.applications.version}} / {{item.name}} / {{org.ad_full_name}} / {{org.applications.count}} / {{item.enabled}}") };
    const result = renderTemplate([repeated], "org-1", values);
    expect(result.valid).toBe(true);
    expect(result.steps.map((step) => step.title)).toEqual(["Install Photoshop Latest", "Install Acrobat 2026"]);
    expect(result.steps[0].body).toEqual(body("Latest / Photoshop / acme.local / 0 / false"));
    expect(result.steps[1].body).toEqual(body("2026 / Acrobat / acme.local / 1 / true"));
    expect(values).toEqual(before);
  });

  it("does not leak repeat bindings into nonrepeated steps or another list", () => {
    const result = renderTemplate([
      { ...globals[1], title: "{{org.applications.name}}" },
      { ...globals[0], id: "outside", position: 30, title: "{{org.applications.name}}" },
      { ...globals[1], id: "other", position: 40, repeatVariableKey: "org.other", title: "{{org.applications.name}} {{item.name}}" },
    ], "org-1", { org: { applications: [{ name: "Photoshop" }], other: [{ name: "Other" }] } });
    expect(result.steps[0].title).toBe("Photoshop");
    expect(result.steps[1].title).toBe("{{org.applications.name}}");
    expect(result.steps[2].title).toBe("{{org.applications.name}} Other");
    expect(result.issues.filter((issue) => issue.variableKey === "org.applications.name").map((issue) => issue.itemId)).toEqual(["outside", "other"]);
  });

  it("rejects missing fields, case mismatches, objects, and prototype properties", () => {
    const result = renderTemplate([{ ...globals[1], title: "{{org.applications.Version}} {{item.missing}} {{item.constructor}} {{item.details}}" }], "org-1", { org: { applications: [{ name: "App", version: "Latest", details: {} }] } });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.variableKey)).toEqual(expect.arrayContaining(["org.applications.Version", "item.missing", "item.constructor", "item.details"]));
  });
});
