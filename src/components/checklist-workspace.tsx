"use client";

import {
  AppWindow, BookOpenCheck, Check, ChevronDown, Clock3, Database, GripVertical,
  Layers3, ListChecks, MoreHorizontal, PanelLeftClose, Plus, Settings2,
  ShieldCheck, Sparkles, Users, Variable,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RichNode } from "@/lib/template-engine";
import { RichTextEditor } from "./rich-text-editor";

type Step = { id: string; itemId?: string; sourceId?: string; title: string; body: RichNode; kind: "global" | "org"; repeat?: string };
export type WorkspaceData = { templateId: string; templateName: string; templateDescription: string; steps: Step[]; organizations: { id: string; name: string }[] };
const doc = (text: string): RichNode => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const richText = (node: RichNode): string => [node.text, ...(node.content ?? []).map(richText)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

const initialSteps: Step[] = [
  { id: "welcome", title: "Confirm the requester and scope", body: doc("Verify the requester, requested completion date, and any special access constraints before making changes."), kind: "global" },
  { id: "ad", title: "Verify the Active Directory domain", body: doc("Confirm the domain is {{org.ad_full_name}} and record any exceptions in the ticket."), kind: "global" },
  { id: "vpn", title: "Apply Acme-specific VPN access", body: doc("Add the user to the managed VPN profile and confirm conditional access is applied."), kind: "org" },
  { id: "apps", title: "Review {{item.name}} access", body: doc("Confirm licensing, assigned role, and manager approval for {{item.name}}."), kind: "global", repeat: "org.applications" },
];

const nav = [
  { label: "Templates", icon: ListChecks, active: true, count: "12", href: "/" },
  { label: "Global library", icon: Layers3, count: "36", href: "/" },
  { label: "Organizations", icon: AppWindow, count: "48", href: "/admin/organizations" },
  { label: "Variables", icon: Variable, count: "9", href: "/admin/variables" },
  { label: "Users", icon: Users, href: "/admin/users" },
  { label: "History", icon: Clock3, href: "/admin/history" },
];

function StatusPill({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "lime" | "amber" | "gray" }) {
  const tones = {
    teal: "bg-teal-50 text-teal-800 ring-teal-200",
    lime: "bg-lime-50 text-lime-800 ring-lime-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    gray: "bg-slate-50 text-slate-600 ring-slate-200",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${tones[tone]}`}>{children}</span>;
}

export function ChecklistWorkspace({ initialData }: { initialData?: WorkspaceData | null }) {
  const [steps, setSteps] = useState(initialData?.steps.length ? initialData.steps : initialSteps);
  const [selectedId, setSelectedId] = useState(initialData?.steps[0]?.id ?? "ad");
  const [organization, setOrganization] = useState(initialData?.organizations[0]?.name ?? "Acme Manufacturing");
  const [preview, setPreview] = useState(false);
  const [previewBlocked, setPreviewBlocked] = useState<string[]>([]);
  const [serverPreview, setServerPreview] = useState<{ id: string; title: string; bodyText: string }[] | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const hydrated = useRef(false);
  const selected = useMemo(() => steps.find((step) => step.id === selectedId) ?? steps[0], [steps, selectedId]);

  function updateSelected(field: "title" | "body", value: string | RichNode) {
    setSteps((current) => current.map((step) => step.id === selectedId ? { ...step, [field]: value } : step));
  }

  async function addStep() {
    const id = `step-${Date.now()}`;
    const draft: Step = { id, title: "Untitled global step", body: doc("Describe the work to complete."), kind: "global" };
    setSteps((current) => [...current, draft]);
    setSelectedId(id);
    if (!initialData?.templateId) return;
    setSaveState("saving");
    try {
      const stepResponse = await fetch("/api/global-steps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: draft.title, body: draft.body }) });
      if (!stepResponse.ok) throw new Error("create_step_failed");
      const source = (await stepResponse.json()).data as { id: string };
      const itemResponse = await fetch(`/api/templates/${initialData.templateId}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "global", globalStepId: source.id, position: (steps.length + 1) * 100 }) });
      if (!itemResponse.ok) throw new Error("create_item_failed");
      const item = (await itemResponse.json()).data as { id: string };
      setSteps((current) => current.map((entry) => entry.id === id ? { ...entry, id: item.id, itemId: item.id, sourceId: source.id } : entry));
      setSelectedId(item.id); setSaveState("saved");
    } catch { setSaveState("error"); }
  }

  async function togglePreview() {
    if (preview) { setPreview(false); return; }
    const selectedOrganization = initialData?.organizations.find((entry) => entry.name === organization);
    if (initialData?.templateId && selectedOrganization) {
      try {
        const response = await fetch(`/api/templates/${initialData.templateId}/preview?organizationId=${selectedOrganization.id}`);
        const result = await response.json() as { data?: { steps: { sourceItemId: string; title: string; body: RichNode; repeatIndex?: number }[] }; validation?: { valid: boolean; invalidVariables: string[] } };
        if (!response.ok) throw new Error("preview_failed");
        setPreviewBlocked(result.validation?.valid ? [] : (result.validation?.invalidVariables ?? ["template validation"]));
        setServerPreview(result.data?.steps.map((step) => ({ id: `${step.sourceItemId}-${step.repeatIndex ?? 0}`, title: step.title, bodyText: richText(step.body) })) ?? []);
      } catch { setPreviewBlocked(["Preview could not be loaded"]); setServerPreview([]); }
    }
    setPreview(true);
  }

  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    if (!selected?.sourceId || !initialData?.templateId) return;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const url = selected.kind === "global" ? `/api/global-steps/${selected.sourceId}` : `/api/templates/${initialData.templateId}/items?itemId=${selected.itemId}`;
      try {
        const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: selected.title, body: selected.body }) });
        setSaveState(response.ok ? "saved" : "error");
      } catch { setSaveState("error"); }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [initialData?.templateId, selected?.body, selected?.itemId, selected?.kind, selected?.sourceId, selected?.title]);

  const rendered = steps.flatMap((step) => step.repeat
    ? ["Microsoft 365", "SentinelOne", "Adobe Acrobat"].map((app) => ({ ...step, id: `${step.id}-${app}`, title: step.title.replaceAll("{{item.name}}", app), bodyText: richText(step.body).replaceAll("{{item.name}}", app) }))
    : [{ ...step, bodyText: richText(step.body).replaceAll("{{org.ad_full_name}}", "acme.local") }]);

  return (
    <div className="min-h-screen bg-[#f3f6f3] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden min-h-screen border-r border-[#d9e2dc] bg-[#102d2a] text-white lg:flex lg:flex-col">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-5">
          <div className="grid size-9 place-items-center rounded-xl bg-[#b7e454] text-[#17322e]"><BookOpenCheck size={20} strokeWidth={2.4} /></div>
          <div><div className="text-[15px] font-semibold tracking-tight">Checklists</div><div className="text-[11px] text-white/50">Version2 workspace</div></div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5">
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-white/35">Workspace</div>
          {nav.map(({ label, icon: Icon, active, count, href }) => (
            <a href={href} key={label} className={`focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition ${active ? "bg-white/12 text-white" : "text-white/63 hover:bg-white/7 hover:text-white"}`}>
              <Icon size={17} /><span className="flex-1">{label}</span>{count && <span className="text-[10px] text-white/35">{count}</span>}
            </a>
          ))}
        </nav>
        <div className="m-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Database size={14} className="text-[#b7e454]" /> IT Glue sync</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[92%] rounded-full bg-[#b7e454]" /></div>
          <div className="mt-2 flex justify-between text-[10px] text-white/45"><span>44 of 48 valid</span><span>2h ago</span></div>
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 p-4">
          <div className="grid size-9 place-items-center rounded-full bg-[#2d5b54] text-xs font-bold">AC</div>
          <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">Adam Carbonell</div><div className="text-[10px] text-white/45">Administrator</div></div>
          <Settings2 size={15} className="text-white/45" />
        </div>
      </aside>

      <main className="min-w-0">
        <header className="flex h-[76px] items-center border-b border-[#d9e2dc] bg-white/85 px-4 backdrop-blur md:px-7">
          <button className="mr-3 rounded-lg p-2 text-slate-500 lg:hidden"><PanelLeftClose size={20} /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-medium text-[#72817d]"><span>Templates</span><span>/</span><span>{initialData?.templateName ?? "Employee onboarding"}</span></div>
            <div className="mt-1 flex items-center gap-2"><h1 className="truncate text-[17px] font-semibold tracking-tight">{initialData?.templateName ?? "Employee onboarding"}</h1><span className={`size-1.5 rounded-full ${saveState === "error" ? "bg-red-500" : "bg-teal-600"} ${saveState === "saving" ? "save-dot" : ""}`} /><span className="text-[10px] text-slate-400">{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved"}</span></div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <button className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl border border-[#d8e1dc] bg-white px-3 text-xs font-medium text-slate-650 hover:bg-slate-50"><Clock3 size={14} /> History</button>
            <button onClick={togglePreview} className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl bg-[#0f766e] px-4 text-xs font-semibold text-white shadow-sm hover:bg-[#0a615b]"><Sparkles size={14} /> {preview ? "Edit template" : "Preview"}</button>
          </div>
        </header>

        <div className="grid min-h-[calc(100vh-76px)] xl:grid-cols-[minmax(0,1fr)_330px]">
          <section className="min-w-0 p-4 md:p-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-[#d9e2dc] bg-white p-1 shadow-sm">
                <button className="rounded-lg bg-[#173f3a] px-3 py-1.5 text-[11px] font-semibold text-white">Canvas</button>
                <button className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-slate-500">Variables</button>
                <button className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-slate-500">Validation</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-slate-500 sm:inline">Preview for</span>
                <div className="relative">
                  <select value={organization} onChange={(event) => { setOrganization(event.target.value); setServerPreview(null); setPreviewBlocked([]); }} className="focus-ring h-9 appearance-none rounded-xl border border-[#d9e2dc] bg-white pl-3 pr-8 text-xs font-medium shadow-sm">
                    {(initialData?.organizations.length ? initialData.organizations.map((entry) => entry.name) : ["Acme Manufacturing", "Northstar Dental", "River City Legal"]).map((name) => <option key={name}>{name}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-3 text-slate-400" />
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[22px] border border-[#d9e2dc] bg-[#fffef9] shadow-[0_18px_55px_rgba(28,50,44,.08)]">
              <div className="paper-grid border-b border-[#e5e9e3] px-6 py-6 md:px-9">
                <div className="flex items-start justify-between gap-4">
                  <div><div className="mb-2 flex items-center gap-2"><StatusPill>Template</StatusPill><span className="text-[11px] text-slate-400">Updated just now</span></div><h2 className="text-2xl font-semibold tracking-[-.03em]">{initialData?.templateName ?? "Employee onboarding"}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#687874]">{initialData?.templateDescription ?? "A consistent onboarding sequence with organization-specific access requirements and validated IT Glue context."}</p></div>
                  <button className="rounded-lg p-2 text-slate-400 hover:bg-white"><MoreHorizontal size={18} /></button>
                </div>
                <div className="mt-5 flex flex-wrap gap-2"><StatusPill tone="lime"><ShieldCheck size={11} className="mr-1" /> 4 variables valid</StatusPill><StatusPill tone="gray">{steps.length} base steps</StatusPill><StatusPill tone="gray">1 org snapshot</StatusPill></div>
              </div>

              <div className="px-3 py-4 md:px-5 md:py-5">
                <div className="mb-3 flex items-center justify-between px-3"><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">Ordered steps</span><span className="text-[10px] text-slate-400">Drag to reorder</span></div>
                <div className="space-y-2">
                  {steps.map((step, index) => (
                    <button key={step.id} onClick={() => setSelectedId(step.id)} className={`focus-ring group grid w-full grid-cols-[24px_32px_minmax(0,1fr)_auto] items-start gap-2 rounded-2xl border p-3 text-left transition md:grid-cols-[24px_36px_minmax(0,1fr)_auto] md:p-4 ${selectedId === step.id ? "border-[#6ebeb2] bg-[#f2fbf8] shadow-[0_5px_18px_rgba(15,118,110,.08)]" : "border-transparent bg-white hover:border-[#dce5df] hover:shadow-sm"}`}>
                      <GripVertical size={16} className="mt-2 text-slate-300 group-hover:text-slate-500" />
                      <span className={`grid size-8 place-items-center rounded-full text-xs font-bold ${step.kind === "org" ? "bg-amber-100 text-amber-800" : "bg-[#e2f1ed] text-[#0f766e]"}`}>{index + 1}</span>
                      <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold text-[#263532]">{step.title}</span>{step.kind === "org" ? <StatusPill tone="amber">Org snapshot</StatusPill> : <StatusPill>Live global</StatusPill>}{step.repeat && <StatusPill tone="lime">Repeats</StatusPill>}</span><span className="mt-1.5 block line-clamp-2 text-xs leading-5 text-[#74817e]">{richText(step.body)}</span></span>
                      <MoreHorizontal size={16} className="mt-2 text-slate-300" />
                    </button>
                  ))}
                </div>
                <button onClick={addStep} className="focus-ring mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#bdcbc5] py-3 text-xs font-semibold text-[#52716b] hover:border-[#6ebeb2] hover:bg-[#f2fbf8]"><Plus size={15} /> Add a step</button>
              </div>
            </div>
          </section>

          <aside className="border-t border-[#d9e2dc] bg-white xl:border-l xl:border-t-0">
            <div className="sticky top-0">
              <div className="border-b border-[#e2e8e3] px-5 py-4"><div className="flex items-center justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">Step inspector</div><div className="mt-1 text-sm font-semibold">Step {Math.max(1, steps.findIndex((step) => step.id === selectedId) + 1)}</div></div><button className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><MoreHorizontal size={17} /></button></div></div>
              <div className="scrollbar-thin max-h-[calc(100vh-150px)] space-y-5 overflow-y-auto p-5">
                <div><label className="mb-2 block text-[11px] font-semibold text-[#4c5e59]">Step title</label><input value={selected?.title ?? ""} onChange={(event) => updateSelected("title", event.target.value)} className="focus-ring w-full rounded-xl border border-[#d8e1dc] bg-white px-3 py-2.5 text-xs font-medium shadow-sm" /></div>
                <div><label className="mb-2 block text-[11px] font-semibold text-[#4c5e59]">Instructions</label><RichTextEditor value={selected?.body ?? doc("")} onChange={(value) => updateSelected("body", value)} onInsertVariable={() => updateSelected("body", doc(`${richText(selected?.body ?? doc(""))} {{org.ad_full_name}}`.trim()))} /></div>
                <div><label className="mb-2 block text-[11px] font-semibold text-[#4c5e59]">Behavior</label><div className="rounded-xl border border-[#d8e1dc] p-3"><label className="flex items-start gap-3"><input type="checkbox" checked={Boolean(selected?.repeat)} readOnly className="mt-0.5 accent-[#0f766e]" /><span><span className="block text-xs font-medium">Repeat for a list variable</span><span className="mt-1 block text-[10px] leading-4 text-slate-400">Creates one rendered step per application.</span></span></label>{selected?.repeat && <div className="mt-3 rounded-lg bg-[#f0f8f5] px-3 py-2 font-mono text-[10px] text-[#0f766e]">org.applications</div>}</div></div>
                <div><label className="mb-2 block text-[11px] font-semibold text-[#4c5e59]">Source behavior</label><div className={`rounded-xl border p-3 ${selected?.kind === "org" ? "border-amber-200 bg-amber-50/60" : "border-teal-200 bg-teal-50/60"}`}><div className="flex items-center gap-2 text-xs font-semibold">{selected?.kind === "org" ? <><AppWindow size={14} className="text-amber-700" /> Organization snapshot</> : <><Layers3 size={14} className="text-teal-700" /> Live global reference</>}</div><p className="mt-1.5 text-[10px] leading-4 text-slate-500">{selected?.kind === "org" ? "This copy is stable. Editing the organization library will not change it." : "Changes to the global library step appear here immediately."}</p></div></div>
                <div className="rounded-xl border border-[#d8e1dc] bg-[#f8faf8] p-3"><div className="flex items-center gap-2 text-xs font-semibold text-[#334a45]"><Check size={14} className="text-teal-600" /> Ready for {organization}</div><p className="mt-1.5 text-[10px] leading-4 text-slate-500">All variables used by this step passed the latest IT Glue validation.</p></div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102d2a]/55 p-4 backdrop-blur-sm" onClick={() => setPreview(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[24px] bg-[#fffef9] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-[#e3e9e4] bg-[#fffef9]/95 px-6 py-4 backdrop-blur"><div><div className="text-[10px] font-semibold uppercase tracking-[.15em] text-teal-700">Organization preview</div><h3 className="mt-1 text-lg font-semibold">{organization}</h3></div><button onClick={() => setPreview(false)} className="rounded-xl border border-[#d8e1dc] px-3 py-2 text-xs font-semibold">Close</button></div>
            <div className="p-6">{previewBlocked.length ? <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><div className="font-semibold">Preview blocked for this organization</div><div className="mt-1 text-[10px]">Resolve: {previewBlocked.join(", ")}. No other organization is affected.</div></div> : <div className="mb-5 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800"><div className="flex items-center gap-2 font-semibold"><ShieldCheck size={15} /> Validated against IT Glue</div><div className="mt-1 text-[10px] text-teal-700">All required organization variables are current and valid.</div></div>}<div className="space-y-5">{(serverPreview ?? rendered).map((step, index) => <div key={step.id} className="flex gap-4"><div className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e2f1ed] text-xs font-bold text-teal-800">{index + 1}</div><div><div className="text-sm font-semibold">{step.title}</div><div className="mt-1 text-xs leading-5 text-slate-600">{step.bodyText}</div></div></div>)}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
