"use client";

import { Save, ShieldCheck } from "lucide-react";
import { useState } from "react";

type Definition = { id: string; key: string; label: string; assetTypeId: string; assetTypeName: string; cardinality: "scalar" | "list"; selectedFields: { sourceKey: string; alias: string; expectedKind: string }[]; validationRules: { exactRecords?: number; minItems?: number; requiredFields?: string[]; sortBy?: string }; schemaValid: boolean };

export function VariableMappingEditor({ initial }: { initial: Definition[] }) {
  const [definitions, setDefinitions] = useState(initial);
  const [status, setStatus] = useState<Record<string, string>>({});
  const update = (id: string, value: Partial<Definition>) => setDefinitions((rows) => rows.map((row) => row.id === id ? { ...row, ...value } : row));
  const updateField = (id: string, value: Partial<Definition["selectedFields"][number]>) => setDefinitions((rows) => rows.map((row) => row.id === id ? { ...row, selectedFields: [{ ...row.selectedFields[0], ...value }, ...row.selectedFields.slice(1)] } : row));
  const save = async (definition: Definition) => {
    setStatus((current) => ({ ...current, [definition.id]: "Saving…" }));
    const response = await fetch(`/api/variables?id=${definition.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: definition.key, label: definition.label, assetTypeId: definition.assetTypeId, assetTypeName: definition.assetTypeName, cardinality: definition.cardinality, selectedFields: definition.selectedFields, validationRules: definition.validationRules }) });
    setStatus((current) => ({ ...current, [definition.id]: response.ok ? "Saved" : "Save failed" }));
  };
  const validate = async (definition: Definition) => {
    setStatus((current) => ({ ...current, [definition.id]: "Validating IT Glue schema…" }));
    const response = await fetch(`/api/variables/${definition.id}/validate`, { method: "POST" });
    const result = await response.json();
    if (response.ok) { update(definition.id, { schemaValid: result.data.schemaValid }); setStatus((current) => ({ ...current, [definition.id]: result.data.schemaValid ? "Schema validated" : result.data.issues.join(", ") })); }
    else setStatus((current) => ({ ...current, [definition.id]: "Validation failed" }));
  };
  return <div className="space-y-4">{definitions.map((definition) => <section key={definition.id} className="rounded-2xl border border-[#d9e2dc] bg-white p-5 shadow-sm">
    <div className="mb-5 flex items-start justify-between gap-4"><div><div className="font-mono text-xs font-semibold text-teal-700">{definition.key}</div><input value={definition.label} onChange={(event) => update(definition.id, { label: event.target.value })} className="mt-2 border-0 p-0 text-lg font-semibold outline-none" /></div><span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-semibold text-teal-800"><ShieldCheck size={12} /> {definition.schemaValid ? "Schema valid" : "Needs review"}</span></div>
    <div className="grid gap-4 md:grid-cols-4"><Field label="Asset type ID"><input value={definition.assetTypeId} onChange={(event) => update(definition.id, { assetTypeId: event.target.value })} className="mapping-input" /></Field><Field label="Asset type"><input value={definition.assetTypeName} onChange={(event) => update(definition.id, { assetTypeName: event.target.value })} className="mapping-input" /></Field><Field label="Cardinality"><select value={definition.cardinality} onChange={(event) => update(definition.id, { cardinality: event.target.value as "scalar" | "list" })} className="mapping-input"><option value="scalar">Scalar</option><option value="list">List</option></select></Field><Field label="Sort alias"><input value={definition.validationRules.sortBy ?? ""} onChange={(event) => update(definition.id, { validationRules: { ...definition.validationRules, sortBy: event.target.value || undefined } })} className="mapping-input" placeholder="Optional" /></Field></div>
    <div className="mt-4 grid gap-4 md:grid-cols-3"><Field label="IT Glue field key"><input value={definition.selectedFields[0]?.sourceKey ?? ""} onChange={(event) => updateField(definition.id, { sourceKey: event.target.value })} className="mapping-input font-mono" /></Field><Field label="Token alias"><input value={definition.selectedFields[0]?.alias ?? ""} onChange={(event) => updateField(definition.id, { alias: event.target.value })} className="mapping-input font-mono" /></Field><Field label="Expected kind"><input value={definition.selectedFields[0]?.expectedKind ?? ""} onChange={(event) => updateField(definition.id, { expectedKind: event.target.value })} className="mapping-input" /></Field></div>
    <div className="mt-5 flex items-center justify-end gap-3"><span className="mr-auto text-xs text-slate-400">{status[definition.id]}</span><button onClick={() => validate(definition)} className="rounded-xl border border-teal-200 px-4 py-2 text-xs font-semibold text-teal-800">Validate schema</button><button onClick={() => save(definition)} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white"><Save size={14} /> Save mapping</button></div>
  </section>)}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-[11px] font-semibold text-slate-600">{label}{children}</label>; }
