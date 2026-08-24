export type RichNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: RichNode[]; [key: string]: unknown };

export type GlobalTemplateItem = {
  id: string;
  kind: "global";
  position: number;
  title: string;
  body: RichNode;
  repeatVariableKey?: string | null;
  deleted?: boolean;
};

export type OrganizationTemplateItem = {
  id: string;
  kind: "organization";
  organizationId: string;
  anchorItemId: string | null;
  placement: "before" | "after" | null;
  position: number;
  title: string;
  body: RichNode;
  repeatVariableKey?: string | null;
  deleted?: boolean;
};

export type TemplateItem = GlobalTemplateItem | OrganizationTemplateItem;
export type VariableValues = Record<string, unknown>;
export type RenderIssue = { code: "missing_anchor" | "missing_variable" | "invalid_list"; itemId: string; variableKey?: string };
export type RenderedStep = { sourceItemId: string; title: string; body: RichNode; repeatIndex?: number };

const tokenPattern = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

export function extractVariableKeys(value: string | RichNode): string[] {
  const strings: string[] = [];
  if (typeof value === "string") strings.push(value);
  else walkRichNode(value, (text) => strings.push(text));
  return [...new Set(strings.flatMap((text) => [...text.matchAll(tokenPattern)].map((match) => match[1])))];
}

export function mergeTemplateItems(items: TemplateItem[], organizationId: string): { items: TemplateItem[]; issues: RenderIssue[] } {
  const globals = items.filter((item): item is GlobalTemplateItem => item.kind === "global" && !item.deleted).sort((a, b) => a.position - b.position);
  const orgItems = items.filter((item): item is OrganizationTemplateItem => item.kind === "organization" && item.organizationId === organizationId && !item.deleted);
  const globalIds = new Set(globals.map((item) => item.id));
  const issues: RenderIssue[] = [];
  const before = new Map<string, OrganizationTemplateItem[]>();
  const after = new Map<string, OrganizationTemplateItem[]>();

  for (const item of orgItems) {
    if (!item.anchorItemId || !globalIds.has(item.anchorItemId) || !item.placement) {
      issues.push({ code: "missing_anchor", itemId: item.id });
      continue;
    }
    const target = item.placement === "before" ? before : after;
    target.set(item.anchorItemId, [...(target.get(item.anchorItemId) ?? []), item]);
  }

  const merged: TemplateItem[] = [];
  for (const item of globals) {
    merged.push(...(before.get(item.id) ?? []).sort((a, b) => a.position - b.position), item, ...(after.get(item.id) ?? []).sort((a, b) => a.position - b.position));
  }
  return { items: merged, issues };
}

export function renderTemplate(items: TemplateItem[], organizationId: string, values: VariableValues) {
  const merged = mergeTemplateItems(items, organizationId);
  const issues = [...merged.issues];
  const steps: RenderedStep[] = [];

  for (const item of merged.items) {
    const repeatKey = item.repeatVariableKey ?? undefined;
    if (repeatKey) {
      const records = getPath(values, repeatKey);
      if (!Array.isArray(records)) {
        issues.push({ code: "invalid_list", itemId: item.id, variableKey: repeatKey });
        continue;
      }
      records.forEach((record, index) => steps.push(renderStep(item, values, isObject(record) ? record : { value: record }, index)));
    } else {
      const missing = [...extractVariableKeys(item.title), ...extractVariableKeys(item.body)]
        .filter((key) => !key.startsWith("item.") && getPath(values, key) == null);
      for (const key of new Set(missing)) issues.push({ code: "missing_variable", itemId: item.id, variableKey: key });
      steps.push(renderStep(item, values));
    }
  }
  return { steps, issues, valid: issues.length === 0 };
}

function renderStep(item: TemplateItem, values: VariableValues, repeated?: Record<string, unknown>, repeatIndex?: number): RenderedStep {
  const context = repeated ? { ...values, item: repeated } : values;
  return { sourceItemId: item.id, title: replaceTokens(item.title, context), body: replaceRichTokens(item.body, context), repeatIndex };
}

export function replaceTokens(text: string, values: VariableValues) {
  return text.replace(tokenPattern, (full, key: string) => {
    const value = getPath(values, key);
    if (value == null || typeof value === "object") return full;
    return String(value);
  });
}

export function replaceRichTokens(node: RichNode, values: VariableValues): RichNode {
  return {
    ...node,
    ...(typeof node.text === "string" ? { text: replaceTokens(node.text, values) } : {}),
    ...(node.content ? { content: node.content.map((child) => replaceRichTokens(child, values)) } : {}),
  };
}

function walkRichNode(node: RichNode, visit: (text: string) => void) {
  if (typeof node.text === "string") visit(node.text);
  node.content?.forEach((child) => walkRichNode(child, visit));
}

function getPath(values: VariableValues, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => isObject(current) ? current[segment] : undefined, values);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
