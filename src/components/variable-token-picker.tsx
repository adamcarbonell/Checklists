"use client";

import type { VariableDefinitionSummary } from "@/lib/workspace-types";
import { Modal } from "./workspace-ui";

export function RepeatedFieldHelp({
  definition,
}: {
  definition?: VariableDefinitionSummary;
}) {
  if (!definition || definition.cardinality !== "list") return null;
  return (
    <div className="rounded-xl bg-teal-50 p-3 text-xs text-teal-950">
      <p className="font-semibold">Fields for each {definition.label} item</p>
      <p className="mt-1">
        Use these tokens in the title or instructions. Each repeated step uses
        one record, not the entire list. Field aliases are case-sensitive.
      </p>
      <ul className="mt-2 space-y-1 break-all font-mono">
        {definition.fieldAliases.map((alias) => (
          <li key={alias}>{`{{${definition.key}.${alias}}}`}</li>
        ))}
      </ul>
      <p className="mt-2">
        {"The short form {{item.field}} also works. Only approved fields are available; an administrator must map, validate, and sync additional fields such as version in Organization variables."}
      </p>
    </div>
  );
}

export function VariableTokenPicker({
  definitions,
  repeatVariableId,
  onInsert,
  onClose,
}: {
  definitions: VariableDefinitionSummary[];
  repeatVariableId: string | null;
  onInsert: (key: string) => void;
  onClose: () => void;
}) {
  const active = definitions.filter((definition) => definition.enabled);
  const repeated = active.find(
    (definition) =>
      definition.id === repeatVariableId && definition.cardinality === "list",
  );
  const scalars = active.filter(
    (definition) => definition.cardinality === "scalar",
  );
  const choice = (key: string) => (
    <button
      type="button"
      key={key}
      onClick={() => onInsert(key)}
      className="w-full break-all rounded-lg border bg-white px-3 py-2 text-left font-mono text-sm text-teal-800 hover:bg-teal-50"
    >
      {`{{${key}}}`}
    </button>
  );
  return (
    <Modal title="Insert variable" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-600">
        Choose a token to add to the instructions. The same tokens can be typed
        into the step title. Aliases are case-sensitive.
      </p>
      {repeated && (
        <section aria-label="Repeated item fields" className="mb-5 space-y-2">
          <h3 className="text-sm font-semibold">
            Current {repeated.label} item
          </h3>
          <p className="text-xs text-slate-600">
            {"Each step gets one record. {{item.field}} is an equivalent short form."}
          </p>
          {repeated.fieldAliases.map((alias) =>
            choice(`${repeated.key}.${alias}`),
          )}
          {!repeated.fieldAliases.length && (
            <p className="text-sm">No approved fields available.</p>
          )}
        </section>
      )}
      <section aria-label="Organization scalar variables" className="space-y-2">
        <h3 className="text-sm font-semibold">Organization variables</h3>
        {scalars.flatMap((definition) =>
          definition.fieldAliases.length > 1
            ? definition.fieldAliases.map((alias) =>
                choice(`${definition.key}.${alias}`),
              )
            : [choice(definition.key)],
        )}
        {!scalars.length && (
          <p className="text-sm text-slate-600">
            No active scalar variables configured.
          </p>
        )}
      </section>
      <p className="mt-5 text-xs text-slate-600">
        {repeated
          ? "Need another field such as version? An administrator must approve its IT Glue field mapping, validate the schema, then sync the organization. Only approved, synced values are available to tokens."
          : "To use application fields, enable Repeat for a list variable and select Applications first. List-field tokens only work inside a step repeating that list."}
      </p>
    </Modal>
  );
}
