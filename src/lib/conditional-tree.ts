import type { TemplateItem, RenderIssue, VariableValues } from "./template-engine";
import type { WorkspaceStep } from "./workspace-types";
import type { TemplateBranch, ConditionField, ConditionDecision, Comparison } from "./conditional-types";

export type TreeNode = { item: TemplateItem; branches: { branch: TemplateBranch; children: TreeNode[] }[] };
export const isGroup = (item: { nodeType?: string }) => item.nodeType === "condition_group";
export function workspaceItems(steps: WorkspaceStep[], organizationId: string): TemplateItem[] {
  return steps.map((step) => ({
    id: step.id, templateId: step.templateId, nodeType: step.nodeType, parentBranchId: step.parentBranchId,
    position: step.position, title: step.title, body: step.body, repeatVariableKey: step.repeat,
    ...(step.kind === "global" ? { kind: "global" as const } : {
      kind: "organization" as const, organizationId: step.organizationId ?? organizationId,
      anchorItemId: step.anchorItemId, placement: step.placement,
    }),
  }));
}

export function buildTemplateTree(input: TemplateItem[], branchInput: TemplateBranch[], organizationId: string) {
  const items = input.filter((item) => !item.deleted && (item.kind === "global" || item.organizationId === organizationId));
  const byId = new Map(items.map((item) => [item.id, item]));
  const branches = branchInput.filter((branch) => !branch.deleted && byId.has(branch.groupItemId));
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
  const issues: RenderIssue[] = [];
  const invalid = new Set<string>();
  const issue = (code: RenderIssue["code"], itemId: string) => {
    invalid.add(itemId);
    if (!issues.some((entry) => entry.code === code && entry.itemId === itemId)) issues.push({ code, itemId });
  };
  if (items.length > 1000 || branches.length > 1000 || byId.size !== items.length || byBranch.size !== branches.length)
    issue("invalid_structure", items[0]?.id ?? "template");
  const parent = new Map<string, string | null>();
  for (const item of items) {
    if (!Number.isInteger(item.position) || item.position < 0) issue("invalid_structure", item.id);
    let container = item.parentBranchId ?? null;
    if (item.kind === "organization" && item.placement !== "start" && item.placement !== "end") {
      const anchor = item.anchorItemId ? byId.get(item.anchorItemId) : undefined;
      if (!anchor || anchor.kind !== "global" || !["before", "after"].includes(item.placement ?? "")) {
        issue("missing_anchor", item.id);
        continue;
      }
      container = anchor.parentBranchId ?? null;
      if (item.parentBranchId) issue("invalid_structure", item.id);
    }
    parent.set(item.id, container);
    if (container) {
      const branch = byBranch.get(container), group = branch && byId.get(branch.groupItemId);
      if (!branch || !group || !isGroup(group)) issue("missing_anchor", item.id);
      else if ((item.kind === "global" && group.kind !== "global") ||
        (item.kind === "organization" && group.kind === "organization" && item.templateId !== group.templateId)) issue("invalid_structure", item.id);
    }
  }
  for (const item of items) {
    let cursor: TemplateItem | undefined = item;
    const path = new Set<string>();
    let depth = isGroup(item) ? 1 : 0;
    while (cursor) {
      if (path.has(cursor.id)) { for (const id of path) issue("invalid_structure", id); break; }
      path.add(cursor.id);
      const branchId = parent.get(cursor.id);
      cursor = branchId ? byId.get(byBranch.get(branchId)?.groupItemId ?? "") : undefined;
      if (cursor && isGroup(cursor)) depth++;
      if (depth > 10) { issue("condition_depth_exceeded", item.id); break; }
    }
    if (isGroup(item)) {
      const rows = branches.filter((branch) => branch.groupItemId === item.id).sort((a, b) => a.position - b.position);
      const otherwise = rows.filter((branch) => branch.condition === null);
      if (!rows.length || rows.some((row) => !Number.isInteger(row.position) || row.position < 0) || rows[0].condition === null || otherwise.length > 1 ||
        (otherwise.length && rows.at(-1)?.id !== otherwise[0].id) ||
        new Set(rows.map((branch) => branch.position)).size !== rows.length || item.repeatVariableKey)
        issue("invalid_structure", item.id);
    }
  }
  const reachable = new Set<string>();
  const container = (branchId: string | null, ancestors: Set<string>): TreeNode[] => {
    const rows = items.filter((item) => !invalid.has(item.id) && parent.get(item.id) === branchId);
    const globals = rows.filter((item) => item.kind === "global").sort((a, b) => a.position - b.position);
    const locals = rows.filter((item) => item.kind === "organization");
    const group = (placement: string, anchor: string | null) => locals.filter((item) => item.kind === "organization" && item.placement === placement && item.anchorItemId === anchor).sort((a, b) => a.position - b.position);
    const ordered = [...group("start", null), ...globals.flatMap((item) => [...group("before", item.id), item, ...group("after", item.id)]), ...group("end", null)];
    return ordered.flatMap((item) => {
      if (ancestors.has(item.id)) return [];
      reachable.add(item.id);
      const next = new Set(ancestors).add(item.id);
      return [{ item, branches: isGroup(item) ? branches.filter((branch) => branch.groupItemId === item.id).sort((a, b) => a.position - b.position).map((branch) => ({ branch, children: container(branch.id, next) })) : [] }];
    });
  };
  const roots = container(null, new Set());
  const unplaced = items.filter((item) => !reachable.has(item.id));
  for (const item of unplaced) if (!invalid.has(item.id)) issue("missing_anchor", item.id);
  return { roots, unplaced, issues, parent };
}

export function ownPath(values: VariableValues, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) =>
    value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part] : undefined, values);
}
export function validComparison(condition: unknown, fields: ConditionField[]): condition is Comparison {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return false;
  const value = condition as Comparison, field = fields.find((entry) => entry.key === value.variableKey);
  return !!field && ["equals", "not_equals"].includes(value.operator) &&
    typeof value.value === (field.kind === "text" ? "string" : field.kind) &&
    (typeof value.value !== "number" || Number.isFinite(value.value));
}
export function evaluateTree(
  tree: ReturnType<typeof buildTemplateTree>, values: VariableValues,
  fields: ConditionField[], states?: Record<string, string>,
) {
  const items: TemplateItem[] = [], issues = [...tree.issues], usedKeys = new Set<string>();
  const decisions: ConditionDecision[] = [];
  const initialize = (nodes: TreeNode[]) => nodes.forEach((node) => {
    if (isGroup(node.item)) decisions.push({ groupId: node.item.id, status: "not_reached", selectedBranchId: null, evaluated: [] });
    node.branches.forEach((branch) => initialize(branch.children));
  });
  initialize(tree.roots);
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (!isGroup(node.item)) { items.push(node.item); continue; }
      const decision = decisions.find((entry) => entry.groupId === node.item.id)!;
      decision.status = "blocked";
      let failed = false;
      for (const row of node.branches) {
        const condition = row.branch.condition;
        let matches = condition === null;
        if (condition !== null) {
          if (typeof condition.variableKey === "string") usedKeys.add(condition.variableKey);
          const field = fields.find((entry) => entry.key === condition.variableKey);
          const approved = validComparison(condition, fields);
          const actual = approved ? ownPath(values, condition.variableKey) : undefined;
          const valid = approved && field &&
            (!states || states[field.definitionKey] === "valid") && actual != null &&
            typeof actual === typeof condition.value && (typeof actual !== "number" || Number.isFinite(actual));
          if (!valid) {
            decision.evaluated.push({ branchId: row.branch.id, condition, result: "invalid" });
            issues.push({ code: field ? "condition_data_invalid" : "invalid_condition", itemId: node.item.id, branchId: row.branch.id, variableKey: condition.variableKey });
            failed = true;
            break;
          }
          const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : value;
          const equal = normalize(actual) === normalize(condition.value);
          matches = condition.operator === "equals" ? equal : !equal;
        }
        decision.evaluated.push({ branchId: row.branch.id, condition, result: matches });
        if (matches) {
          decision.status = "selected";
          decision.selectedBranchId = row.branch.id;
          visit(row.children);
          break;
        }
      }
      if (!decision.selectedBranchId && !failed) issues.push({ code: "condition_no_match", itemId: node.item.id });
    }
  };
  visit(tree.roots);
  return { items, issues, decisions, usedKeys };
}
