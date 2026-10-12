"use client";
import { useEffect, useMemo, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import {
  GripVertical,
  Plus,
  Clock3,
  Sparkles,
  Layers3,
  AppWindow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { extractVariableKeys } from "@/lib/template-engine";
import type {
  WorkspaceData,
  WorkspaceStep,
  WorkspaceUser,
  TemplateContext,
  LibraryStep,
} from "@/lib/workspace-types";
import { visibleOrder, moveStep } from "@/lib/template-order";
import { RichTextEditor } from "./rich-text-editor";
import {
  ActionMenu,
  HistoryDialog,
  Modal,
  TextPrompt,
  RepeatControl,
  WorkspaceShell,
  api,
  doc,
  textOf,
  useSaves,
  type MenuAction,
  MutationGate,
} from "./workspace-ui";
export type { WorkspaceData } from "@/lib/workspace-types";
const demoSteps: WorkspaceStep[] = [
  {
    id: "g1",
    sourceId: "demo-1",
    title: "Confirm the requester and scope",
    body: doc("Confirm the requested scope."),
    kind: "global",
    position: 100,
    organizationId: null,
    anchorItemId: null,
    placement: null,
    repeatVariableId: null,
  },
  {
    id: "g2",
    sourceId: "demo-2",
    title: "Verify the Active Directory domain",
    body: doc("Confirm {{org.ad_full_name}}."),
    kind: "global",
    position: 200,
    organizationId: null,
    anchorItemId: null,
    placement: null,
    repeatVariableId: null,
  },
  {
    id: "o1",
    sourceId: "demo-org",
    title: "Organization-specific access",
    body: doc("Review organization requirements."),
    kind: "org",
    position: 100,
    organizationId: "demo-org",
    anchorItemId: "g2",
    placement: "after",
    repeatVariableId: null,
  },
];
const demoData: WorkspaceData = {
  templateId: "demo",
  templateName: "Employee onboarding",
  templateDescription: "Development demonstration",
  steps: demoSteps,
  organizations: [{ id: "demo-org", name: "Demo organization" }],
  definitions: [
    {
      id: "demo-list",
      key: "org.applications",
      label: "Applications",
      cardinality: "list",
      enabled: true,
      schemaValid: true,
    },
  ],
  templates: [{ id: "demo", name: "Employee onboarding" }],
  globalCount: 2,
};

export function ChecklistWorkspace({
  initialData,
  user,
  demo = false,
}: {
  initialData?: WorkspaceData | null;
  user: WorkspaceUser;
  demo?: boolean;
}) {
  const [data, setData] = useState<WorkspaceData | null>(
    initialData ?? (demo ? demoData : null),
  );
  const [selectedId, setSelectedId] = useState(data?.steps[0]?.id ?? "");
  const [organizationId, setOrganizationId] = useState<string | null>(
    data?.organizations[0]?.id ?? null,
  );
  const [tab, setTab] = useState("Canvas");
  const [context, setContext] = useState<TemplateContext | null>(null),
    [contextError, setContextError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ type: string; id: string }[] | null>(
      null,
    ),
    [preview, setPreview] = useState(false),
    [details, setDetails] = useState(false),
    [add, setAdd] = useState(false);
  const [dropHint, setDropHint] = useState("");
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [insertingVariable, setInsertingVariable] = useState(false);
  const [library, setLibrary] = useState<LibraryStep[]>([]),
    [sourceChoice, setSourceChoice] = useState(""),
    [draftName, setDraftName] = useState(data?.templateName ?? ""),
    [draftDescription, setDraftDescription] = useState(
      data?.templateDescription ?? "",
    );
  const [deletedList, setDeletedList] = useState<
    { id: string; name: string }[] | null
  >(null);
  const { state: saveState, queue } = useSaves();
  const canEdit = user.role !== "viewer";
  const [gate] = useState(() => new MutationGate());
  const router = useRouter();
  const ordered = useMemo(
    () => visibleOrder(data?.steps ?? [], organizationId),
    [data?.steps, organizationId],
  );
  const selected = ordered.find((s) => s.id === selectedId) ?? ordered[0];
  const selectedKeys = selected
    ? [
        ...extractVariableKeys(selected.title),
        ...extractVariableKeys(selected.body),
        ...(selected.repeat ? [selected.repeat] : []),
      ]
    : [];
  const orgName = data?.organizations.find(
    (o) => o.id === organizationId,
  )?.name;
  async function refresh() {
    if (demo) return;
    if (data) {
      const result = await api(`/api/templates/${data.templateId}/workspace`);
      setData(result.data);
    }
    await refreshContext();
  }
  async function refreshContext() {
    if (demo || !data || !organizationId) {
      setContext(null);
      return;
    }
    try {
      const result = await api(
        `/api/templates/${data.templateId}/context?organizationId=${organizationId}`,
      );
      setContext(result.data);
      setContextError("");
    } catch (e) {
      setContext(null);
      setContextError((e as Error).message);
    }
  }
  useEffect(() => {
    let alive = true;
    if (demo || !data || !organizationId || saveState !== "saved") return;
    void api(
      `/api/templates/${data.templateId}/context?organizationId=${organizationId}`,
    )
      .then((r) => {
        if (alive) {
          setContext(r.data);
          setContextError("");
        }
      })
      .catch(() => {
        if (alive) setContextError("Organization context could not be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [organizationId, saveState, demo, data]);
  async function action(work: () => Promise<void>) {
    if (!gate.enter()) return;
    setBusy(true);
    setError("");
    try {
      await queue.flush();
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      gate.leave();
      setBusy(false);
    }
  }
  function updateStep(change: Partial<WorkspaceStep>) {
    if (!selected || !data || !canEdit) return;
    const updated = { ...selected, ...change };
    const definition = data.definitions.find(
      (d) => d.id === updated.repeatVariableId,
    );
    updated.repeat = definition?.key;
    setContext(null);
    setData({
      ...data,
      steps: data.steps.map((s) =>
        (
          selected.kind === "global"
            ? s.kind === "global" && s.sourceId === selected.sourceId
            : s.id === selected.id
        )
          ? { ...s, ...change, repeat: updated.repeat }
          : s,
      ),
    });
    if (demo) return;
    queue.schedule(
      selected.kind === "global"
        ? `global:${selected.sourceId}`
        : `item:${selected.id}`,
      selected.kind === "global"
        ? `/api/global-steps/${selected.sourceId}`
        : `/api/templates/${data.templateId}/items?itemId=${selected.id}`,
      {
        title: updated.title,
        body: updated.body,
        repeatVariableId: updated.repeatVariableId,
      },
    );
  }
  const scopeOrder = (steps: WorkspaceStep[]) =>
    steps
      .filter((s) => s.kind === "global" || s.organizationId === organizationId)
      .map((s) => ({
        itemId: s.id,
        position: s.position,
        anchorItemId: s.anchorItemId,
        placement: s.placement,
      }));
  async function reorder(
    id: string,
    targetId: string,
    side: "before" | "after",
  ) {
    if (!data || !canEdit) return;
    await action(async () => {
      const previous = data;
      const proposed = moveStep(data.steps, id, targetId, side, organizationId);
      if (JSON.stringify(proposed) === JSON.stringify(data.steps)) return;
      setData({ ...data, steps: proposed });
      setContext(null);
      try {
        if (!demo)
          await api(`/api/templates/${data.templateId}/order`, "PATCH", {
            organizationId,
            movedItemId: id,
            expectedOrder: scopeOrder(data.steps),
            proposedOrder: scopeOrder(proposed),
          });
        await refreshContext();
      } catch (e) {
        setData(previous);
        throw e;
      }
    });
  }
  function move(id: string, direction: number) {
    if (!data) return;
    const step = data.steps.find((s) => s.id === id);
    const rows =
      step?.kind === "global"
        ? ordered.filter((s) => s.kind === "global")
        : ordered;
    const index = rows.findIndex((s) => s.id === id);
    const target = rows[index + direction];
    if (target) void reorder(id, target.id, direction < 0 ? "before" : "after");
  }
  async function remove(step: WorkspaceStep) {
    if (!data) return;
    const anchored = data.steps.filter((s) => s.anchorItemId === step.id);
    if (
      !window.confirm(
        anchored.length
          ? `Remove this entry? ${anchored.length} organization snapshot(s) will need a new anchor.`
          : "Remove this entry from the template? Its library source will remain available.",
      )
    )
      return;
    await action(async () => {
      if (!demo)
        await api(
          `/api/templates/${data.templateId}/items?itemId=${step.id}`,
          "DELETE",
        );
      setData({ ...data, steps: data.steps.filter((s) => s.id !== step.id) });
      setSelectedId("");
    });
  }
  function stepMenu(step: WorkspaceStep): MenuAction[] {
    const movable =
      step.kind === "global"
        ? ordered.filter((s) => s.kind === "global")
        : ordered;
    const index = movable.findIndex((s) => s.id === step.id);
    return [
      {
        label: "Move up",
        disabled: !canEdit || busy || index <= 0,
        onClick: () => move(step.id, -1),
      },
      {
        label: "Move down",
        disabled: !canEdit || busy || index === movable.length - 1,
        onClick: () => move(step.id, 1),
      },
      {
        label: "Step history",
        disabled: demo,
        onClick: () =>
          void action(async () =>
            setHistory([
              {
                type: step.kind === "global" ? "global_step" : "template_item",
                id: step.kind === "global" ? step.sourceId! : step.id,
              },
            ]),
          ),
      },
      ...(step.kind === "global" && step.sourceId
        ? [
            {
              label: "Open global library source",
              onClick: () =>
                action(async () =>
                  router.push(`/global-library?stepId=${step.sourceId}`),
                ),
            },
          ]
        : []),
      {
        label: "Remove from template",
        disabled: !canEdit || busy,
        danger: true,
        onClick: () => remove(step),
      },
    ];
  }
  function templateHistory() {
    if (data)
      void action(async () =>
        setHistory([{ type: "template_history", id: data.templateId }]),
      );
  }
  async function createTemplate(name: string) {
    await action(async () => {
      const result = await api("/api/templates", "POST", { name });
      setCreatingTemplate(false);
      router.push(`/?templateId=${result.data.id}`);
    });
  }
  async function deletedTemplates() {
    await action(async () => {
      const result = await api("/api/templates?includeDeleted=true");
      setDeletedList(
        result.data.filter((t: { deletedAt: string | null }) => t.deletedAt),
      );
    });
  }
  const header = (
    <header className="flex min-h-[76px] items-center justify-between gap-3 border-b border-[#d9e2dc] bg-white/85 px-6 py-3">
      <div>
        <p className="text-[11px] text-slate-500">
          Templates /{" "}
          {data && data.templates.length > 1 ? (
            <select
              aria-label="Choose template"
              disabled={busy}
              value={data.templateId}
              className="max-w-64 bg-transparent"
              onChange={(event) => {
                const id = event.target.value;
                void action(async () => router.push(`/?templateId=${id}`));
              }}
            >
              {data.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          ) : (
            (data?.templateName ?? "Workspace")
          )}
        </p>
        <h1 className="mt-1 text-lg font-semibold">
          {data?.templateName ?? "Templates"}{" "}
          <span
            className={saveState === "error" ? "text-red-700" : "text-teal-700"}
            style={{ fontSize: 10 }}
          >
            {demo
              ? "Demo · browser only"
              : saveState === "saved"
                ? busy
                  ? "Working…"
                  : "Saved"
                : saveState === "saving"
                  ? "Saving…"
                  : "Save failed"}
          </span>
        </h1>
      </div>
      <div className="flex gap-2">
        {canEdit && (
          <button
            className="rounded-xl border px-3 py-2 text-xs"
            onClick={() => setCreatingTemplate(true)}
          >
            New template
          </button>
        )}
        {data && (
          <>
            <button
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
              onClick={templateHistory}
              disabled={demo}
            >
              <Clock3 size={14} />
              History
            </button>
            <button
              className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs text-white disabled:opacity-50"
              disabled={!organizationId || busy}
              onClick={() =>
                void action(async () => {
                  await refreshContext();
                  setPreview(true);
                })
              }
            >
              <Sparkles size={14} />
              Preview
            </button>
          </>
        )}
      </div>
    </header>
  );
  const templateActions: MenuAction[] = [
    {
      label: "Edit template details",
      disabled: !canEdit,
      onClick: () =>
        void action(async () => {
          setDraftName(data!.templateName);
          setDraftDescription(data!.templateDescription);
          setDetails(true);
        }),
    },
    { label: "Template history", disabled: demo, onClick: templateHistory },
    { label: "Deleted templates", disabled: demo, onClick: deletedTemplates },
    {
      label: "Delete template",
      danger: true,
      disabled: !canEdit || demo,
      onClick: () =>
        action(async () => {
          if (
            !window.confirm(
              "Soft-delete this template? It can be restored from history.",
            )
          )
            return;
          await api(`/api/templates/${data!.templateId}`, "DELETE");
          router.push("/");
          router.refresh();
        }),
    },
  ];
  return (
    <WorkspaceShell
      user={user}
      active="templates"
      counts={{
        templates: data?.templates.length ?? 0,
        library: data?.globalCount ?? 0,
        organizations: data?.organizations.length ?? 0,
        variables: data?.definitions.length ?? 0,
      }}
      beforeNavigate={() => queue.flush()}
    >
      {header}
      {(error || contextError) && (
        <div
          role="alert"
          className="m-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error || contextError}
          <button
            className="ml-4 underline"
            onClick={() => void action(refresh)}
          >
            Reload
          </button>
        </div>
      )}
      {saveState === "error" && (
        <button
          className="m-5 rounded-lg bg-amber-100 px-4 py-2 text-xs"
          onClick={() => void action(async () => queue.flush())}
        >
          Retry unsaved changes
        </button>
      )}
      {!data ? (
        <div className="p-8">
          <p className="text-slate-600">No active template available.</p>
          <button
            className="mt-4 rounded-xl border px-4 py-2 text-xs"
            onClick={deletedTemplates}
          >
            View deleted templates
          </button>
        </div>
      ) : (
        <>
          <div className="grid min-h-[calc(100vh-76px)] xl:grid-cols-[minmax(0,1fr)_330px]">
            <section className="min-w-0 p-4 md:p-7">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div
                  role="tablist"
                  aria-label="Template views"
                  className="flex rounded-xl border border-[#d9e2dc] bg-white p-1"
                >
                  {["Canvas", "Variables", "Validation"].map((name) => (
                    <button
                      key={name}
                      role="tab"
                      id={`workspace-tab-${name}`}
                      aria-controls={`workspace-panel-${name}`}
                      tabIndex={tab === name ? 0 : -1}
                      aria-selected={tab === name}
                      className={`rounded-lg px-3 py-1.5 text-xs ${tab === name ? "bg-[#173f3a] text-white" : "text-slate-500"}`}
                      onClick={() => setTab(name)}
                      onKeyDown={(event) => {
                        if (
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        const tabs = ["Canvas", "Variables", "Validation"];
                        const index =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? 2
                              : (tabs.indexOf(name) +
                                  (event.key === "ArrowRight" ? 1 : -1) +
                                  3) %
                                3;
                        setTab(tabs[index]);
                        document
                          .getElementById(`workspace-tab-${tabs[index]}`)
                          ?.focus();
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Preview for
                  <select
                    aria-label="Preview organization"
                    disabled={!data.organizations.length || busy}
                    value={organizationId ?? ""}
                    onChange={(e) => {
                      setContext(null);
                      setContextError("");
                      setOrganizationId(e.target.value || null);
                      setSelectedId("");
                    }}
                    className="rounded-xl border bg-white p-2 text-xs"
                  >
                    <option value="">Choose organization</option>
                    {data.organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {tab === "Canvas" ? (
                <div
                  role="tabpanel"
                  id="workspace-panel-Canvas"
                  aria-labelledby="workspace-tab-Canvas"
                  className="overflow-hidden rounded-[22px] border border-[#d9e2dc] bg-[#fffef9] shadow-lg"
                >
                  <div className="paper-grid border-b px-6 py-6">
                    <div className="flex justify-between">
                      <div>
                        <span className="text-xs text-teal-700">Template</span>
                        <h2 className="mt-2 text-2xl font-semibold">
                          {data.templateName}
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                          {data.templateDescription}
                        </p>
                      </div>
                      <ActionMenu
                        label="Template actions"
                        actions={templateActions}
                      />
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full border px-3 py-1">
                        {context
                          ? context.valid
                            ? "Variables and template valid"
                            : "Validation needs review"
                          : organizationId
                            ? "Validation unavailable"
                            : "Select an organization"}
                      </span>
                      <span className="rounded-full border px-3 py-1">
                        {ordered.filter((s) => s.kind === "global").length}{" "}
                        global entries
                      </span>
                      <span className="rounded-full border px-3 py-1">
                        {ordered.filter((s) => s.kind === "org").length} org
                        snapshots
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="mb-3 flex justify-between text-[10px] uppercase tracking-widest text-slate-400">
                      <span>Ordered steps</span>
                      <span>
                        {canEdit
                          ? "Drag the handle or use Move up/down"
                          : "Read-only"}
                      </span>
                    </div>
                    <DragDropProvider
                      onDragOver={(event) => {
                        const source = event.operation.source;
                        if (!source || !isSortable(source)) return;
                        const target = ordered[source.index];
                        if (!target) return;
                        const proposed = moveStep(
                          data.steps,
                          String(source.id),
                          target.id,
                          source.index < source.initialIndex
                            ? "before"
                            : "after",
                          organizationId,
                        );
                        const moved = proposed.find(
                          (step) => step.id === source.id,
                        );
                        if (moved?.kind === "org")
                          setDropHint(
                            `Place organization step ${moved.placement ?? "beside"} ${data.steps.find((step) => step.id === moved.anchorItemId)?.title ?? "a valid global anchor"}`,
                          );
                        else
                          setDropHint(
                            "Moving this global step also moves its anchored organization steps.",
                          );
                      }}
                      onDragEnd={(event) => {
                        setDropHint("");
                        if (event.canceled) return;
                        const source = event.operation.source;
                        if (
                          !source ||
                          !isSortable(source) ||
                          source.index === undefined ||
                          source.initialIndex === undefined
                        )
                          return;
                        const target = ordered[source.index];
                        if (target)
                          void reorder(
                            String(source.id),
                            target.id,
                            source.index < source.initialIndex
                              ? "before"
                              : "after",
                          );
                      }}
                    >
                      <div className="space-y-2">
                        {ordered.map((step, index) => (
                          <StepRow
                            key={step.id}
                            step={step}
                            index={index}
                            selected={selected?.id === step.id}
                            disabled={
                              !canEdit || busy || step.sourceMissing === true
                            }
                            onSelect={() => setSelectedId(step.id)}
                            actions={stepMenu(step)}
                            globals={data.steps.filter(
                              (s) => s.kind === "global",
                            )}
                          />
                        ))}
                      </div>
                    </DragDropProvider>
                    {dropHint && (
                      <p
                        role="status"
                        className="mt-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-800"
                      >
                        {dropHint}
                      </p>
                    )}
                    {!ordered.length && (
                      <p className="p-5 text-sm text-slate-500">
                        This template has no steps yet.
                      </p>
                    )}
                    {canEdit && (
                      <button
                        onClick={() =>
                          void action(async () => {
                            if (!demo)
                              setLibrary((await api("/api/global-steps")).data);
                            setSourceChoice("");
                            setAdd(true);
                          })
                        }
                        disabled={busy}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-xs text-teal-800"
                      >
                        <Plus size={15} />
                        Add a step
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  role="tabpanel"
                  id={`workspace-panel-${tab}`}
                  aria-labelledby={`workspace-tab-${tab}`}
                  className="rounded-2xl border bg-white p-5"
                >
                  {!organizationId ? (
                    <p>
                      Select an organization to view its {tab.toLowerCase()}.
                    </p>
                  ) : !context ? (
                    <p className="text-sm text-slate-500">
                      {contextError || "Context unavailable."}
                    </p>
                  ) : tab === "Variables" ? (
                    <div className="space-y-4">
                      {context.variables.map((v) => (
                        <section key={v.id} className="rounded-xl border p-4">
                          <div className="flex justify-between">
                            <h3 className="text-sm font-semibold">{v.label}</h3>
                            <span className="text-xs">
                              {v.status}
                              {v.used ? " · used here" : ""}
                            </span>
                          </div>
                          <code className="mt-2 block text-xs text-teal-700">{`{{${v.key}}}`}</code>
                          <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">
                            {v.value === null
                              ? "No normalized value"
                              : JSON.stringify(v.value, null, 2)}
                          </pre>
                          <p className="mt-2 text-xs text-slate-500">
                            Last refresh:{" "}
                            {v.syncedAt
                              ? new Date(v.syncedAt).toLocaleString()
                              : "Never"}
                          </p>
                          {v.issues.length > 0 && (
                            <p className="mt-2 text-xs text-amber-800">
                              {v.issues.join(", ")}
                            </p>
                          )}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <h2
                        className={`text-sm font-semibold ${context.valid ? "text-teal-800" : "text-amber-800"}`}
                      >
                        {context.valid
                          ? "Ready to preview"
                          : "Preview blocked for this organization"}
                      </h2>
                      {context.invalidVariables.map((k) => (
                        <p
                          key={k}
                          className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"
                        >
                          Variable needs attention: {k}
                        </p>
                      ))}
                      {context.issues.map((issue, i) => (
                        <button
                          key={i}
                          className="mt-3 block w-full rounded-lg bg-amber-50 p-3 text-left text-sm"
                          onClick={() => {
                            setSelectedId(issue.itemId);
                            setTab("Canvas");
                          }}
                        >
                          {issue.code.replaceAll("_", " ")} ·{" "}
                          {data.steps.find((s) => s.id === issue.itemId)
                            ?.title ?? issue.itemId}
                          {issue.variableKey ? ` · ${issue.variableKey}` : ""}
                        </button>
                      ))}
                      {context.valid && (
                        <p className="mt-3 text-sm text-slate-500">
                          Referenced variables and placement anchors passed
                          validation.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
            <aside className="border-l border-[#d9e2dc] bg-white">
              <div className="flex justify-between border-b p-5">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400">
                    Step inspector
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {selected
                      ? `Step ${ordered.findIndex((s) => s.id === selected.id) + 1}`
                      : "Select a step"}
                  </p>
                </div>
                {selected && (
                  <ActionMenu
                    label="Selected step actions"
                    actions={stepMenu(selected)}
                  />
                )}
              </div>
              {selected && (
                <div className="space-y-5 p-5">
                  <label className="block text-xs">
                    Step title
                    <input
                      aria-label="Step title"
                      disabled={!canEdit || selected.sourceMissing}
                      value={selected.title}
                      onChange={(e) => updateStep({ title: e.target.value })}
                      className="mt-2 w-full rounded-xl border p-3 text-xs"
                    />
                  </label>
                  <div>
                    <p className="mb-2 text-xs">Instructions</p>
                    <RichTextEditor
                      key={selected.id}
                      value={selected.body}
                      editable={canEdit && !selected.sourceMissing}
                      onChange={(body) => updateStep({ body })}
                      onInsertVariable={() => setInsertingVariable(true)}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs">Behavior</p>
                    <RepeatControl
                      value={selected.repeatVariableId}
                      definitions={data.definitions}
                      disabled={!canEdit || selected.sourceMissing}
                      onChange={(repeatVariableId) =>
                        updateStep({ repeatVariableId })
                      }
                    />
                  </div>
                  <div className="rounded-xl border bg-teal-50 p-3">
                    <p className="flex gap-2 text-xs font-semibold">
                      {selected.kind === "global" ? (
                        <Layers3 size={14} />
                      ) : (
                        <AppWindow size={14} />
                      )}{" "}
                      {selected.kind === "global"
                        ? "Live global reference"
                        : "Organization snapshot"}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {selected.kind === "global"
                        ? "Editing updates every template using this global step."
                        : "Editing updates only this template snapshot."}
                    </p>
                    {selected.kind === "org" && (
                      <p className="mt-2 text-xs">
                        {selected.placement ?? "Missing placement"}:{" "}
                        {data.steps.find((s) => s.id === selected.anchorItemId)
                          ?.title ?? "Missing anchor — drag to repair"}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border p-3 text-xs">
                    {context
                      ? context.issues.some((i) => i.itemId === selected.id) ||
                        context.invalidVariables.some((key) =>
                          selectedKeys.includes(key),
                        )
                        ? "Review Validation for this organization"
                        : `Ready for ${orgName}`
                      : "Validation unavailable"}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
      {creatingTemplate && canEdit && (
        <TextPrompt
          title="New template"
          label="Template name"
          maxLength={160}
          submitLabel="Create template"
          errorMessage={error}
          onClose={() => setCreatingTemplate(false)}
          onSubmit={createTemplate}
        />
      )}
      {insertingVariable && selected && data && canEdit && (
        <TextPrompt
          title="Insert variable"
          label="Variable token"
          submitLabel="Insert variable"
          initialValue={data.definitions[0]?.key ?? "org.ad_full_name"}
          suggestions={data.definitions
            .filter((definition) => definition.enabled)
            .map((definition) => definition.key)}
          onClose={() => setInsertingVariable(false)}
          onSubmit={(key) => {
            updateStep({
              body: {
                ...selected.body,
                content: [
                  ...(selected.body.content ?? []),
                  ...doc(`{{${key}}}`).content,
                ],
              },
            });
            setInsertingVariable(false);
          }}
        />
      )}
      {deletedList && (
        <Modal title="Deleted templates" onClose={() => setDeletedList(null)}>
          {!deletedList.length && (
            <p className="text-sm">No deleted templates available.</p>
          )}
          {deletedList.map((t) => (
            <button
              key={t.id}
              className="mb-2 block w-full rounded-lg border p-3 text-left text-sm"
              onClick={() => {
                setDeletedList(null);
                setHistory([{ type: "template", id: t.id }]);
              }}
            >
              {t.name} · View recovery history
            </button>
          ))}
        </Modal>
      )}
      {history && (
        <HistoryDialog
          entities={history}
          canEdit={canEdit}
          onClose={() => setHistory(null)}
          onRestored={async () => {
            if (
              !data ||
              history.some(
                (h) => h.type === "template" && h.id !== data.templateId,
              )
            ) {
              router.push("/");
              return;
            }
            await refresh();
          }}
        />
      )}
      {preview && (
        <Modal
          title={`Organization preview — ${orgName ?? "Unavailable"}`}
          onClose={() => setPreview(false)}
        >
          {!context || !context.valid ? (
            <p className="rounded-xl bg-amber-50 p-4 text-sm">
              Preview blocked. Review the Validation tab for this organization.
            </p>
          ) : (
            <ol className="space-y-4">
              {context.steps.map((s, i) => (
                <li key={`${s.sourceItemId}-${s.repeatIndex ?? 0}`}>
                  <h3 className="text-sm font-semibold">
                    {i + 1}. {s.title}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                    {textOf(s.body)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
      {details && data && (
        <Modal title="Edit template details" onClose={() => setDetails(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (!demo)
                  await api(`/api/templates/${data.templateId}`, "PATCH", {
                    name: draftName,
                    description: draftDescription,
                  });
                setData({
                  ...data,
                  templateName: draftName,
                  templateDescription: draftDescription,
                  templates: data.templates.map((template) =>
                    template.id === data.templateId
                      ? { ...template, name: draftName }
                      : template,
                  ),
                });
                setDetails(false);
              });
            }}
            className="space-y-4"
          >
            <label className="block text-xs">
              Name
              <input
                required
                maxLength={160}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="mt-2 w-full rounded-lg border p-3"
              />
            </label>
            <label className="block text-xs">
              Description
              <textarea
                maxLength={2000}
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="mt-2 w-full rounded-lg border p-3"
              />
            </label>
            <button
              disabled={busy}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white"
            >
              Save details
            </button>
          </form>
        </Modal>
      )}
      {add && data && (
        <Modal title="Add a global step" onClose={() => setAdd(false)}>
          <label className="block text-sm">
            Library step
            <select
              aria-label="Library step"
              value={sourceChoice}
              onChange={(e) => setSourceChoice(e.target.value)}
              className="mt-2 w-full rounded-lg border p-3"
            >
              <option value="">Create a new global step</option>
              {library.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (demo) {
                  setData({
                    ...data,
                    steps: [
                      ...data.steps,
                      {
                        ...demoSteps[0],
                        id: `demo-${Date.now()}`,
                        sourceId: `source-${Date.now()}`,
                        title: "Untitled global step",
                        position:
                          Math.max(
                            0,
                            ...data.steps
                              .filter((s) => s.kind === "global")
                              .map((s) => s.position),
                          ) + 100,
                      },
                    ],
                  });
                  setAdd(false);
                  return;
                }
                const sourceId =
                  sourceChoice ||
                  (
                    await api("/api/global-steps", "POST", {
                      title: "Untitled global step",
                      body: doc("Describe the work to complete."),
                    })
                  ).data.id;
                const item = (
                  await api(`/api/templates/${data.templateId}/items`, "POST", {
                    kind: "global",
                    globalStepId: sourceId,
                    position:
                      Math.max(
                        0,
                        ...data.steps
                          .filter((s) => s.kind === "global")
                          .map((s) => s.position),
                      ) + 100,
                  })
                ).data;
                await refresh();
                setSelectedId(item.id);
                setAdd(false);
              })
            }
          >
            Add to template
          </button>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
function StepRow({
  step,
  index,
  selected,
  disabled,
  onSelect,
  actions,
  globals,
}: {
  step: WorkspaceStep;
  index: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  actions: MenuAction[];
  globals: WorkspaceStep[];
}) {
  const { ref, handleRef, isDragSource, isDropTarget } = useSortable({
    id: step.id,
    index,
    disabled,
  });
  const missing =
    step.kind === "org" &&
    (!step.placement || !globals.some((g) => g.id === step.anchorItemId));
  return (
    <div
      ref={ref}
      data-step-id={step.id}
      className={`grid grid-cols-[24px_32px_minmax(0,1fr)_auto] items-start gap-2 rounded-2xl border p-4 ${selected ? "border-[#6ebeb2] bg-[#f2fbf8]" : "border-transparent bg-white"} ${isDragSource ? "opacity-50" : ""} ${isDropTarget ? "ring-2 ring-teal-500" : ""}`}
    >
      <button
        ref={handleRef}
        disabled={disabled}
        aria-label={`Drag step ${index + 1}: ${step.title}`}
        className="mt-2 touch-none cursor-grab text-slate-400 disabled:cursor-default disabled:opacity-30"
      >
        <GripVertical size={16} />
      </button>
      <span className="grid size-8 place-items-center rounded-full bg-[#e2f1ed] text-xs font-bold text-teal-800">
        {index + 1}
      </span>
      <button onClick={onSelect} className="min-w-0 text-left">
        <span className="text-[13px] font-semibold">{step.title}</span>
        <span className="ml-2 inline-block rounded-full border px-2 py-1 text-[10px] text-teal-800">
          {step.kind === "global" ? "Live global" : "Org snapshot"}
        </span>
        {step.repeatVariableId && (
          <span className="ml-2 text-[10px] text-lime-800">Repeats</span>
        )}
        <span className="mt-1.5 block line-clamp-2 text-xs leading-5 text-slate-500">
          {textOf(step.body)}
        </span>
        {missing && (
          <span className="mt-2 block text-xs text-red-700">
            Missing anchor — drag to a global step to repair
          </span>
        )}
      </button>
      <ActionMenu label={`Step ${index + 1} actions`} actions={actions} />
    </div>
  );
}
