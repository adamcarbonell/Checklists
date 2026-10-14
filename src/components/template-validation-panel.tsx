"use client";

import { summarizeRenderIssues } from "@/lib/template-engine";
import type { ContextVariable, TemplateContext, WorkspaceStep } from "@/lib/workspace-types";

function variableProblem(variable: ContextVariable) {
  if (!variable.enabled) return "This variable is disabled. An administrator must review its mapping.";
  if (!variable.schemaValid) return "The mapping needs schema validation before its data can be used.";
  if (variable.issues.includes("mapping_changed_requires_sync"))
    return "The mapping changed. Schema validation checks the field definitions, but does not fetch values. Refresh this organization's data to populate the newly approved fields.";
  if (variable.status === "stale") return "Stored values are stale or the last refresh failed. Refresh this organization's data.";
  if (variable.status === "pending") return "No successful refresh is available yet. Refresh this organization's data.";
  return "The stored values failed validation. Review this variable's issues in the Variables tab.";
}

export function TemplateValidationPanel({
  context,
  steps,
  canSync,
  busy,
  onSync,
  onSelectStep,
  onInspectVariables,
}: {
  context: TemplateContext;
  steps: WorkspaceStep[];
  canSync: boolean;
  busy: boolean;
  onSync: () => void;
  onSelectStep: (id: string) => void;
  onInspectVariables: () => void;
}) {
  const invalid = new Set(context.invalidVariables);
  const visibleIssues = summarizeRenderIssues(context.issues).filter((issue) => {
    if (issue.code !== "missing_variable" || !issue.variableKey) return true;
    const repeatedId = steps.find((step) => step.id === issue.itemId)?.repeatVariableId;
    const variable = context.variables.find((variable) =>
      issue.variableKey!.startsWith("item.")
        ? variable.id === repeatedId
        : issue.variableKey === variable.key || issue.variableKey!.startsWith(`${variable.key}.`),
    );
    // Until the underlying variable is valid, its refresh/validation problem is
    // actionable; repeating all of its derived field errors obscures that cause.
    return !variable || !invalid.has(variable.key);
  });
  return (
    <div className="rounded-xl border bg-white p-6">
      <h2 className="font-semibold">{context.valid ? "Ready to create a checklist" : "Checklist creation blocked"}</h2>
      {context.valid ? (
        <p className="mt-2 text-sm text-slate-500">Referenced variables and placement anchors passed validation.</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {context.invalidVariables.map((key) => {
              const variable = context.variables.find((variable) => variable.key === key);
              return (
                <li key={key} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-semibold">{variable ? `${variable.label} — ${variable.status}` : `Unknown variable: ${key}`}</p>
                  <code className="mt-1 block text-xs">{key}</code>
                  <p className="mt-2">{variable ? variableProblem(variable) : "Review the token and its approved mapping."}</p>
                </li>
              );
            })}
            {visibleIssues.map((issue) => (
              <li key={JSON.stringify([issue.code, issue.itemId, issue.variableKey])}>
                <button className="text-left text-sm text-red-700 underline" onClick={() => onSelectStep(issue.itemId)}>
                  {steps.find((step) => step.id === issue.itemId)?.title ?? "Template"}: {issue.code}
                  {issue.variableKey ? ` — ${issue.variableKey}` : ""}
                  {(issue.occurrences ?? 1) > 1 ? ` (${issue.occurrences} repeated records)` : ""}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={onInspectVariables} className="rounded-xl border px-4 py-2 text-sm">Inspect variables</button>
            {canSync && context.variables.some((variable) => variable.used && variable.enabled && variable.schemaValid) && (
              <button type="button" disabled={busy} onClick={onSync} className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40">
                {busy ? "Working…" : "Refresh organization data"}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">Opening this panel never contacts IT Glue. Only an administrator can explicitly refresh approved organization data.</p>
        </>
      )}
    </div>
  );
}
