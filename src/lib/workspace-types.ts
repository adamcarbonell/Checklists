import type { RichNode, RenderIssue, RenderedStep } from "./template-engine";
import type { AppRole } from "./roles";

export type WorkspaceUser = { name: string; email: string; role: AppRole };
export type WorkspaceStep = {
  id: string;
  sourceId: string | null;
  title: string;
  body: RichNode;
  kind: "global" | "org";
  position: number;
  organizationId: string | null;
  anchorItemId: string | null;
  placement: "before" | "after" | null;
  repeatVariableId: string | null;
  repeat?: string;
  sourceMissing?: boolean;
};
export type VariableDefinitionSummary = {
  id: string;
  key: string;
  label: string;
  cardinality: "scalar" | "list";
  schemaValid: boolean;
  enabled: boolean;
};
export type WorkspaceData = {
  templateId: string;
  templateName: string;
  templateDescription: string;
  steps: WorkspaceStep[];
  organizations: { id: string; name: string }[];
  definitions: VariableDefinitionSummary[];
  templates: { id: string; name: string }[];
  globalCount: number;
};
export type ContextVariable = VariableDefinitionSummary & {
  value: unknown;
  status: string;
  issues: string[];
  syncedAt: string | null;
  used: boolean;
};
export type TemplateContext = {
  organizationId: string;
  variables: ContextVariable[];
  issues: RenderIssue[];
  invalidVariables: string[];
  valid: boolean;
  steps: RenderedStep[];
};
export type LibraryStep = {
  id: string;
  title: string;
  body: RichNode;
  repeatVariableId: string | null;
  deletedAt?: string | null;
  references: { id: string; name: string }[];
};
