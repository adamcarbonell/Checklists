"use client";
import { useDroppable } from "@dnd-kit/react";
import type { ReactNode } from "react";
import { ActionMenu, type MenuAction } from "./workspace-ui";
import { conditionFields, type Comparison, type ConditionField } from "@/lib/conditional-types";
import { buildTemplateTree, workspaceItems, type TreeNode } from "@/lib/conditional-tree";
import type { WorkspaceData, TemplateContext, WorkspaceStep } from "@/lib/workspace-types";

const input = "mt-1 w-full rounded-lg border bg-white p-2 text-sm disabled:opacity-60";
export function defaultComparison(field: ConditionField): Comparison {
  return { variableKey: field.key, operator: "equals", value: field.kind === "boolean" ? false : field.kind === "number" ? 0 : "" };
}
export function RuleEditor({ value, fields, disabled, onChange }: {
  value: Comparison; fields: ConditionField[]; disabled: boolean; onChange: (value: Comparison) => void;
}) {
  const field = fields.find((row) => row.key === value.variableKey);
  return <div className="space-y-2">
    <label className="block text-xs">Organization field
      <select className={input} aria-label="Condition field" value={value.variableKey} disabled={disabled} onChange={(event) => {
        const next = fields.find((row) => row.key === event.target.value);
        if (next) onChange(defaultComparison(next));
      }}>
        {!field && <option value={value.variableKey}>Unavailable: {value.variableKey}</option>}
        {fields.map((row) => <option key={row.key} value={row.key}>{row.label} ({row.kind})</option>)}
      </select>
    </label>
    <label className="block text-xs">Comparison
      <select className={input} aria-label="Condition operator" value={value.operator} disabled={disabled} onChange={(event) => onChange({ ...value, operator: event.target.value as Comparison["operator"] })}>
        <option value="equals">equals</option><option value="not_equals">does not equal</option>
      </select>
    </label>
    <label className="block text-xs">Literal value
      {field?.kind === "boolean" ? <select className={input} aria-label="Condition value" disabled={disabled} value={String(value.value)} onChange={(event) => onChange({ ...value, value: event.target.value === "true" })}>
        <option value="true">True</option><option value="false">False</option>
      </select> : <input className={input} aria-label="Condition value" disabled={disabled} type={field?.kind === "number" ? "number" : "text"} step="any" maxLength={2000}
        value={String(value.value)} onChange={(event) => onChange({ ...value, value: field?.kind === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value })} />}
    </label>
    <p className="text-[11px] text-slate-500">{field?.kind === "text" ? "Capitalization and outer whitespace are ignored. Internal spaces and saved input are preserved." : "Values are compared by type, without conversion."}</p>
  </div>;
}
export function BranchDropZone({ id, disabled, label }: { id: string; disabled: boolean; label: string }) {
  const { ref, isDropTarget } = useDroppable({ id, disabled });
  return <div ref={ref} data-drop-zone={id} className={`rounded-lg border border-dashed p-2 text-center text-xs ${isDropTarget ? "border-teal-600 bg-teal-100 ring-2 ring-teal-400" : "text-slate-400"}`}>{label}</div>;
}
export function ConditionalCanvas({ data, context, disabled, canEdit, row, onAdd, branchActions }: {
  data: WorkspaceData; context: TemplateContext | null; disabled: boolean; canEdit: boolean;
  row: (step: WorkspaceStep) => ReactNode;
  onAdd: (branchId: string, group: boolean) => void;
  branchActions: (group: WorkspaceStep, branchId: string) => MenuAction[];
}) {
  const orgId = data.organizationId ?? "", tree = buildTemplateTree(workspaceItems(data.steps, orgId), data.branches ?? [], orgId);
  const render = (nodes: TreeNode[]): ReactNode => nodes.map((node) => {
    const step = data.steps.find((entry) => entry.id === node.item.id)!;
    const decision = context?.conditionDecisions?.find((entry) => entry.groupId === step.id);
    return <div key={step.id} className="space-y-2">
      {row(step)}
      {node.branches.length > 0 && <div className="ml-5 space-y-3 border-l-2 border-teal-200 pl-3">
        {node.branches.map(({ branch, children }, index) => {
          const status = !context ? "Unavailable" : decision?.status === "blocked" ? "Blocked" : decision?.selectedBranchId === branch.id ? "Selected" : "Not selected";
          return <details key={branch.id} open className="rounded-xl border bg-white" data-branch-id={branch.id}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-xs">
              <span className="font-bold text-teal-800">{branch.condition === null ? "ELSE" : index === 0 ? "IF" : "ELSE IF"}</span>
              <span className="min-w-0 break-words">{branch.condition ? `${branch.condition.variableKey} ${branch.condition.operator === "equals" ? "=" : "≠"} ${JSON.stringify(branch.condition.value)}` : "Otherwise"}</span>
              <span className={`ml-auto rounded-full px-2 py-1 ${status === "Selected" ? "bg-lime-100" : status === "Blocked" ? "bg-red-50 text-red-800" : "bg-slate-100"}`}>{status}</span>
              <ActionMenu label={`Branch ${index+1} actions for ${step.title}`} actions={branchActions(step, branch.id)} />
            </summary>
            <div className="space-y-2 border-t p-3">
              {canEdit && <BranchDropZone id={`branch:${branch.id}:start`} disabled={disabled} label="Branch start — drop here" />}
              {render(children)}
              {!children.length && <p className="p-2 text-xs text-slate-500">Empty branch — intentional no-op</p>}
              {canEdit && <>
                <BranchDropZone id={`branch:${branch.id}:end`} disabled={disabled} label="Branch end — drop here" />
                <div className="flex flex-wrap gap-3 text-xs text-teal-800">
                  <button disabled={disabled} onClick={() => onAdd(branch.id, false)}>+ Add {data.scope === "organization" ? "local" : "standard"} step</button>
                  <button disabled={disabled} onClick={() => onAdd(branch.id, true)}>+ Add conditional group</button>
                </div>
              </>}
            </div>
          </details>;
        })}
      </div>}
    </div>;
  });
  return <div className="space-y-3">
    {render(tree.roots)}
    {!!tree.unplaced.length && <section className="space-y-2 rounded-xl border border-red-300 bg-red-50 p-3">
      <h3 className="text-sm font-semibold text-red-800">Unplaced content — repair its location to create checklists</h3>
      {tree.unplaced.map((node) => <div key={node.id}>{row(data.steps.find((entry) => entry.id === node.id)!)}</div>)}
    </section>}
  </div>;
}
export { conditionFields };
