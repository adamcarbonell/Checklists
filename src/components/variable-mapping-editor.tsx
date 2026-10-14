"use client";

import { Plus, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";

type Definition = {
  id: string;
  key: string;
  label: string;
  assetTypeId: string;
  assetTypeName: string;
  cardinality: "scalar" | "list";
  selectedFields: { sourceKey: string; alias: string; expectedKind: string }[];
  validationRules: {
    exactRecords?: number;
    minItems?: number;
    requiredFields?: string[];
    sortBy?: string;
  };
  schemaValid: boolean;
};

export function VariableMappingEditor({ initial }: { initial: Definition[] }) {
  const [definitions, setDefinitions] = useState(initial);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const update = (id: string, value: Partial<Definition>) => {
    setDefinitions((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...value } : row)),
    );
    setDirty((current) => ({ ...current, [id]: true }));
    setStatus((current) => ({ ...current, [id]: "Unsaved mapping changes" }));
  };
  const save = async (definition: Definition) => {
    setBusy((current) => ({ ...current, [definition.id]: true }));
    setStatus((current) => ({ ...current, [definition.id]: "Saving…" }));
    try {
      const response = await fetch(`/api/variables?id=${definition.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: definition.key,
          label: definition.label,
          assetTypeId: definition.assetTypeId,
          assetTypeName: definition.assetTypeName,
          cardinality: definition.cardinality,
          selectedFields: definition.selectedFields,
          validationRules: definition.validationRules,
        }),
      });
      if (!response.ok) throw new Error("save_failed");
      const result = await response.json();
      setDefinitions((rows) =>
        rows.map((row) =>
          row.id === definition.id
            ? { ...row, schemaValid: result.data.schemaValid }
            : row,
        ),
      );
      setDirty((current) => ({ ...current, [definition.id]: false }));
      setStatus((current) => ({
        ...current,
        [definition.id]: "Saved. Validate schema, then sync the organization to refresh approved values.",
      }));
    } catch {
      setStatus((current) => ({
        ...current,
        [definition.id]: "Save could not be confirmed. Check field keys, unique lowercase aliases, and expected kinds before retrying.",
      }));
    } finally {
      setBusy((current) => ({ ...current, [definition.id]: false }));
    }
  };
  const validate = async (definition: Definition) => {
    setBusy((current) => ({ ...current, [definition.id]: true }));
    setStatus((current) => ({ ...current, [definition.id]: "Validating IT Glue schema…" }));
    try {
      const response = await fetch(`/api/variables/${definition.id}/validate`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("validation_failed");
      const result = await response.json();
      setDefinitions((rows) =>
        rows.map((row) =>
          row.id === definition.id
            ? { ...row, schemaValid: result.data.schemaValid }
            : row,
        ),
      );
      setStatus((current) => ({
        ...current,
        [definition.id]: result.data.schemaValid
          ? "Schema validated. Sync the organization to populate newly approved fields."
          : result.data.issues.join(", "),
      }));
    } catch {
      setStatus((current) => ({ ...current, [definition.id]: "Validation failed. No sample result was substituted." }));
    } finally {
      setBusy((current) => ({ ...current, [definition.id]: false }));
    }
  };
  return (
    <div className="space-y-4">
      {definitions.map((definition) => (
        <section key={definition.id} className="rounded-2xl border border-[#d9e2dc] bg-white p-5 shadow-sm">
          <fieldset disabled={busy[definition.id]}>
            <legend className="font-mono text-xs font-semibold text-teal-700">{definition.key}</legend>
            <div className="mb-5 mt-2 flex items-start justify-between gap-4">
              <input aria-label={`Label for ${definition.key}`} value={definition.label} onChange={(event) => update(definition.id, { label: event.target.value })} className="border-0 p-0 text-lg font-semibold outline-none" />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-semibold text-teal-800"><ShieldCheck size={12} /> {definition.schemaValid && !dirty[definition.id] ? "Schema valid" : "Needs review"}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Asset type ID"><input value={definition.assetTypeId} onChange={(event) => update(definition.id, { assetTypeId: event.target.value })} className="mapping-input" /></Field>
              <Field label="Asset type"><input value={definition.assetTypeName} onChange={(event) => update(definition.id, { assetTypeName: event.target.value })} className="mapping-input" /></Field>
              <Field label="Cardinality"><select value={definition.cardinality} onChange={(event) => update(definition.id, { cardinality: event.target.value as "scalar" | "list" })} className="mapping-input"><option value="scalar">Scalar</option><option value="list">List</option></select></Field>
              <Field label="Sort alias"><input value={definition.validationRules.sortBy ?? ""} onChange={(event) => update(definition.id, { validationRules: { ...definition.validationRules, sortBy: event.target.value || undefined } })} className="mapping-input" placeholder="Optional" /></Field>
            </div>
            <h3 className="mt-5 text-sm font-semibold">Approved fields</h3>
            <p className="mt-1 text-xs text-slate-600">
              Only these fields are retained. Use the exact IT Glue field key and a unique lowercase alias, such as version. The special key name uses the asset display name. To select a separate Name trait whose key is name, enter traits.name instead. Password and upload fields are not allowed.
            </p>
            <div className="mt-3 space-y-3">
              {definition.selectedFields.map((field, index) => {
                const changeField = (value: Partial<typeof field>) => update(definition.id, {
                  selectedFields: definition.selectedFields.map((entry, position) => position === index ? { ...entry, ...value } : entry),
                });
                const label = `${index + 1} for ${definition.label}`;
                return (
                  <div key={index} className="rounded-xl border p-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label={`IT Glue field key ${label}`}><input value={field.sourceKey} onChange={(event) => changeField({ sourceKey: event.target.value })} className="mapping-input font-mono" /></Field>
                      <Field label={`Token alias ${label}`}><input value={field.alias} onChange={(event) => changeField({ alias: event.target.value })} className="mapping-input font-mono" pattern="[a-z][a-z0-9_]*" /></Field>
                      <Field label={`Expected kind ${label}`}><input value={field.expectedKind} onChange={(event) => changeField({ expectedKind: event.target.value })} className="mapping-input" /></Field>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <code className="break-all text-xs text-teal-800">{`{{${definition.cardinality === "list" || definition.selectedFields.length > 1 ? `${definition.key}.${field.alias || "field"}` : definition.key}}}`}</code>
                      <button type="button" disabled={definition.selectedFields.length === 1} onClick={() => update(definition.id, { selectedFields: definition.selectedFields.filter((_, position) => position !== index) })} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40" aria-label={`Remove approved field ${label}`}>Remove field</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" disabled={definition.selectedFields.length >= 50} onClick={() => update(definition.id, { selectedFields: [...definition.selectedFields, { sourceKey: "", alias: "", expectedKind: "Text" }] })} className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-40"><Plus size={14} /> Add approved field</button>
            <p className="mt-3 text-xs text-slate-600">Adding a row does not change the saved mapping. Save to approve the exact fields, validate the saved schema, then manually sync the organization. List-field tokens require a step repeating that list. Removing an alias may invalidate existing templates.</p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <span role="status" className="mr-auto text-xs text-slate-600">{status[definition.id]}</span>
              <button type="button" disabled={dirty[definition.id]} onClick={() => validate(definition)} className="rounded-xl border border-teal-200 px-4 py-2 text-xs font-semibold text-teal-800 disabled:opacity-40">Validate schema</button>
              <button type="button" onClick={() => save(definition)} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white"><Save size={14} /> Save mapping</button>
            </div>
          </fieldset>
        </section>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-[11px] font-semibold text-slate-600">{label}{children}</label>;
}
