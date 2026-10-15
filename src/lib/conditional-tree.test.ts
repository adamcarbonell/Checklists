import { describe, expect, it } from "vitest";
import { renderTemplate, type TemplateItem } from "./template-engine";
import { buildTemplateTree, validComparison } from "./conditional-tree";
import { conditionFields, type Comparison, type TemplateBranch } from "./conditional-types";
import { moveStep, visibleOrder } from "./template-order";
import type { WorkspaceStep } from "./workspace-types";
const doc = (text = "") => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const node = (id: string, parentBranchId: string | null = null, group = false): TemplateItem => ({
  id, kind: "global", templateId: "global", nodeType: group ? "condition_group" : "step", parentBranchId, position: 100, title: id, body: doc(id),
});
const rule = (value: Comparison["value"], variableKey = "org.email.type", operator: Comparison["operator"] = "equals"): Comparison => ({ variableKey, operator, value });
const branch = (id: string, groupItemId: string, condition: Comparison | null, position = 100): TemplateBranch => ({ id, groupItemId, condition, position });
const fields = [
  { key: "org.email.type", definitionKey: "org.email", kind: "text" as const, label: "Email: type" },
  { key: "org.count", definitionKey: "org.count", kind: "number" as const, label: "Count" },
  { key: "org.enabled", definitionKey: "org.enabled", kind: "boolean" as const, label: "Enabled" },
];
const nodes = [node("Email", null, true), node("Office", "office"), node("Google", "google"), node("Other", "other")];
const branches = [branch("office", "Email", rule("Office 365")), branch("google", "Email", rule("GSuite"), 200), branch("other", "Email", null, 300)];
const render = (type: unknown, items = nodes, rows = branches, states?: Record<string,string>) =>
  renderTemplate(items, "org", { org: { email: { type } } }, { branches: rows, conditionFields: fields, variableStates: states });
describe("conditional template pipeline", () => {
  it("selects only the first match and records evaluated decisions", () => {
    const result = render("Office 365", nodes, [branches[0], branch("google", "Email", rule("Office 365"), 200), branches[2]]);
    expect(result.valid).toBe(true);
    expect(result.steps.map((row) => row.title)).toEqual(["Office"]);
    expect(result.conditionDecisions[0]).toMatchObject({ selectedBranchId: "office", evaluated: [{ branchId: "office", result: true }] });
    expect(result.usedVariableKeys).toEqual(["org.email.type"]);
  });
  it("ignores capitalization and outer whitespace without modifying literals", () => {
    const literal = rule("  OfFiCe 365  "), rows = [{ ...branches[0], condition: literal }, ...branches.slice(1)];
    expect(render(" office 365 ", nodes, rows).steps[0].title).toBe("Office");
    expect(literal.value).toBe("  OfFiCe 365  ");
    expect(render("Office  365").steps[0].title).toBe("Other");
    expect(render("Google Workspace").steps[0].title).toBe("Other");
  });
  it("supports ELSE IF, ELSE and an intentional empty branch", () => {
    expect(render("GSuite").steps.map((row) => row.title)).toEqual(["Google"]);
    expect(render("Another").steps.map((row) => row.title)).toEqual(["Other"]);
    const result = render("Another", nodes.filter((row) => row.id !== "Other"));
    expect(result.valid).toBe(true); // overall empty-checklist rejection is shared at the context layer
    expect(result.steps).toHaveLength(0);
    expect(result.conditionDecisions[0].selectedBranchId).toBe("other");
  });
  it("blocks a reached group without a match and never invents steps", () => {
    const result = render("Other", nodes, branches.slice(0,2));
    expect(result.issues).toContainEqual({ code: "condition_no_match", itemId: "Email" });
    expect(result.steps).toHaveLength(0);
  });
  it.each([undefined, null, 1, true, {}, ["Office 365"]])("blocks malformed or missing text data: %j", (value) => {
    const result = render(value);
    expect(result.valid).toBe(false);
    expect(result.conditionDecisions[0].selectedBranchId).toBeNull();
    expect(result.issues.some((row) => row.code === "condition_data_invalid")).toBe(true);
  });
  it.each(["stale","invalid","pending"])("blocks %s data instead of selecting ELSE", (status) => {
    expect(render("Other", nodes, branches, { "org.email": status }).steps).toHaveLength(0);
  });
  it("compares numbers and Booleans without coercion, including not-equals", () => {
    for (const [key,value] of [["org.count", 0], ["org.enabled", false]] as const) {
      const values = { org: { count: 0, enabled: false } }, input = [node("g", null, true), node("yes", "b")];
      const options = { branches: [branch("b", "g", rule(value,key))], conditionFields: fields };
      expect(renderTemplate(input, "org", values, options).valid).toBe(true);
      expect(renderTemplate(input, "org", { org: { count: "0", enabled: "false" } }, options).valid).toBe(false);
      expect(renderTemplate(input, "org", values, { ...options, branches: [branch("b","g",rule(value === false ? true : 1,key,"not_equals"))] }).valid).toBe(true);
    }
  });
  it("does not evaluate nested rules or validate tokens and repetition in inactive branches", () => {
    const input = [...nodes, node("nested", "google", true), { ...node("bad", "n"), title: "{{org.missing}}", repeatVariableKey: "org.missingList" }];
    const rows = [...branches, branch("n","nested",rule(1,"org.count"))];
    const result = render("Office 365", input, rows);
    expect(result.valid).toBe(true);
    expect(result.conditionDecisions.find((row) => row.groupId === "nested")?.status).toBe("not_reached");
    expect(result.usedVariableKeys).not.toContain("org.count");
    expect(render("GSuite", input, rows).valid).toBe(false);
  });
  it("evaluates conditions before expansion and enforces the rendered-step ceiling", () => {
    const input = [node("g",null,true), { ...node("repeat","b"), repeatVariableKey: "org.apps", title: "{{item.name}}" }];
    const options = { branches: [branch("b","g",rule("Office 365"))], conditionFields: fields };
    expect(renderTemplate(input,"org",{ org: { email: { type: "Office 365" }, apps: Array.from({length:1000},()=>({name:"App"})) } },options).steps).toHaveLength(1000);
    expect(renderTemplate(input,"org",{ org: { email: { type: "Office 365" }, apps: Array.from({length:1001},()=>({name:"App"})) } },options).issues.some((row)=>row.code==="too_many_steps")).toBe(true);
  });
  it("makes local anchors follow global nodes into their new branch", () => {
    const local: TemplateItem = { ...node("local"), templateId: "child", kind: "organization", organizationId: "org", anchorItemId: "Office", placement: "after" };
    const moved = nodes.map((row) => row.id === "Office" ? { ...row, parentBranchId: "google", position: 200 } : row);
    expect(render("Office 365", [...moved,local]).steps).toHaveLength(0);
    expect(render("GSuite", [...moved,local]).steps.map((row)=>row.title)).toEqual(["Google","Office","local"]);
    const deleted = moved.filter((row)=>row.id!=="Office");
    expect(render("Office 365",[...deleted,local]).issues).toContainEqual({code:"missing_anchor",itemId:"local"});
  });
  it("blocks structural errors even in an inactive branch", () => {
    const broken = [node("cycle", "self", true), ...nodes];
    expect(render("Office 365",broken,[...branches,branch("self","cycle",rule("GSuite"))]).issues.some((row)=>row.code==="invalid_structure")).toBe(true);
    expect(render("Office 365",nodes,[branches[2], {...branches[0], position:400}, branches[1]]).valid).toBe(false);
  });
  it("allows ten nested groups but rejects eleven", () => {
    const input = Array.from({length:10},(_,i)=>node("g"+i,i ? "b"+(i-1) : null,true));
    const rows = input.map((item,i)=>branch("b"+i,item.id,rule("Office 365")));
    expect(render("Office 365",[...input,node("leaf","b9")],rows).valid).toBe(true);
    expect(render("Office 365",[...input,node("g10","b9",true)],[...rows,branch("b10","g10",rule("Office 365"))]).issues.some((row)=>row.code==="condition_depth_exceeded")).toBe(true);
  });
  it("restricts fields and literal types to approved scalar metadata", () => {
    const selected = conditionFields([{key:"org.apps",label:"Apps",cardinality:"list",enabled:true,fieldAliases:["name"]},
      {key:"org.email",label:"Email",cardinality:"scalar",enabled:true,fieldAliases:["type","count","active","raw"],fieldKinds:{type:"Text",count:"Number",active:"Checkbox",raw:"Tag"}}]);
    expect(selected.map((row)=>row.key)).toEqual(["org.email.type","org.email.count","org.email.active"]);
    expect(validComparison(rule("0","org.count"),fields)).toBe(false);
    expect(validComparison(rule("Office","item.type"),fields)).toBe(false);
    expect(render("Office 365",nodes,[{...branches[0],condition:{variableKey:1} as unknown as Comparison}]).valid).toBe(false);
  });
});

describe("conditional node movement", () => {
  const rows: WorkspaceStep[] = nodes.map((item) => ({ ...item, kind:"global", templateId:"global", inherited:false, version:1, organizationId:null, anchorItemId:null,placement:null,repeatVariableId:null })) as WorkspaceStep[];
  it("moves a subtree by changing only the root container", () => {
    const moved = moveStep(rows,"Office","Google","after",branches);
    expect(moved.find((row)=>row.id==="Office")?.parentBranchId).toBe("google");
    expect(visibleOrder(moved,branches).map((row)=>row.id)).toEqual(["Email","Google","Office","Other"]);
    expect(moveStep(rows,"Email","branch:office:end","after",branches)).toEqual(rows);
  });
  it("keeps broken local containers visible for repair", () => {
    const local: TemplateItem = { ...node("local","gone"),kind:"organization",organizationId:"org",placement:"end",anchorItemId:null };
    const tree=buildTemplateTree([...nodes,local],branches,"org");
    expect(tree.unplaced.map((row)=>row.id)).toEqual(["local"]);
  });
});
