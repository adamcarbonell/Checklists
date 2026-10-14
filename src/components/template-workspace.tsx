"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { GripVertical, Plus, Clock3, Eye, LockKeyhole } from "lucide-react";
import type {
  WorkspaceData,
  WorkspaceStep,
  WorkspaceUser,
  TemplateContext,
} from "@/lib/workspace-types";
import {
  moveStep,
  visibleOrder,
  stepOrder,
  orderEntry,
} from "@/lib/template-order";
import { SaveQueue } from "@/lib/save-queue";
import { RichTextEditor } from "./rich-text-editor";
import { RichInstructions } from "./rich-instructions";
import { RepeatedFieldHelp, VariableTokenPicker } from "./variable-token-picker";
import {
  WorkspaceShell,
  ActionMenu,
  Modal,
  HistoryDialog,
  RepeatControl,
  api,
  doc,
  textOf,
  MutationGate,
  type MenuAction,
} from "./workspace-ui";
const button =
  "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const primary =
  "rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40";
export function TemplateWorkspace({
  initialData,
  user,
}: {
  initialData: WorkspaceData;
  user: WorkspaceUser;
}) {
  const router = useRouter(),
    canEdit = user.role !== "viewer";
  const [data, setData] = useState(initialData),
    [selectedId, setSelectedId] = useState(initialData.steps[0]?.id ?? ""),
    [tab, setTab] = useState("Canvas"),
    [orgId, setOrgId] = useState<string | null>(
      initialData.organizationId ?? initialData.organizations[0]?.id ?? null,
    );
  const [context, setContext] = useState<TemplateContext | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved"),
    [epoch, setEpoch] = useState(0);
  const [history, setHistory] = useState<{
      entities: { type: string; id: string }[];
      readOnly: boolean;
    } | null>(null),
    [preview, setPreview] = useState(false),
    [details, setDetails] = useState(false),
    [variable, setVariable] = useState(false);
  const [name, setName] = useState(initialData.templateName),
    [description, setDescription] = useState(initialData.templateDescription),
    [dropHint, setDropHint] = useState("");
  const [versions] = useState(
    () => new Map(initialData.steps.map((step) => [step.id, step.version])),
  );
  const [templateVersions] = useState(
    () => new Map([[initialData.templateId, initialData.version]]),
  );
  const [drafts] = useState(() => new Map<string, Record<string, unknown>>());
  const [gate] = useState(() => new MutationGate());
  const [queue] = useState(
    () =>
      new SaveQueue(
        async (url, body) => {
          const id = new URL(url, "http://local").searchParams.get("itemId")!;
          const result = await api(url, "PATCH", {
            ...body,
            expectedVersion: versions.get(id),
          });
          versions.set(id, result.data.version);
          templateVersions.set(
            initialData.templateId,
            result.data.templateVersion,
          );
          if (drafts.get(id) === body) drafts.delete(id);
          setData((current) => ({
            ...current,
            steps: current.steps.map((step) =>
              step.id === id ? { ...step, version: result.data.version } : step,
            ),
          }));
        },
        (state) => {
          setSaveState(state);
          if (state === "saved") setEpoch((value) => value + 1);
        },
      ),
  );
  const ordered = useMemo(() => visibleOrder(data.steps), [data.steps]),
    selected = ordered.find((step) => step.id === selectedId) ?? ordered[0];
  const owned = selected && !selected.inherited && canEdit && !busy;
  function accept(next: WorkspaceData) {
    templateVersions.set(next.templateId, next.version);
    for (const step of next.steps)
      versions.set(step.id, Math.max(step.version, versions.get(step.id) ?? 0));
    setData({
      ...next,
      steps: next.steps.map((step) => ({
        ...step,
        ...(drafts.get(step.id) ?? {}),
        version: versions.get(step.id)!,
      })),
    });
  }
  async function reload() {
    const result = await api(`/api/templates/${data.templateId}/workspace`);
    accept(result.data);
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.hasPending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      queue.dispose();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [queue]);
  useEffect(() => {
    let canceled = false;
    const refresh = () => {
      if (saveState === "saved" && !busy && !document.hidden)
        void api(`/api/templates/${initialData.templateId}/workspace`)
          .then((result) => {
            if (!canceled) accept(result.data);
          })
          .catch(() => {
            if (!canceled)
              setError(
                "Template refresh failed. No sample data was substituted.",
              );
          });
    };
    refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      canceled = true;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
    // accept uses stable draft/version maps; this refresh runs after the save queue drains.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, initialData.templateId, saveState, busy]);
  useEffect(() => {
    let canceled = false;
    if (orgId && saveState === "saved")
      void api(
        `/api/templates/${data.templateId}/context?organizationId=${orgId}`,
      )
        .then((result) => {
          if (!canceled) setContext(result.data);
        })
        .catch(() => {
          if (!canceled) setError("Organization context is unavailable.");
        });
    return () => {
      canceled = true;
    };
  }, [data.templateId, data.version, data.parent?.version, orgId, saveState]);
  async function action(work: () => Promise<void>) {
    if (!gate.enter()) return;
    setBusy(true);
    setError("");
    try {
      await queue.flush();
      await work();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      gate.leave();
      setBusy(false);
    }
  }
  function update(change: Partial<WorkspaceStep>) {
    if (!selected || !owned) return;
    const next = { ...selected, ...change },
      payload = {
        title: next.title,
        body: next.body,
        repeatVariableId: next.repeatVariableId,
      };
    drafts.set(next.id, payload);
    setContext(null);
    setData((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === next.id ? next : step)),
    }));
    queue.schedule(
      next.id,
      `/api/templates/${data.templateId}/items?itemId=${next.id}`,
      payload,
    );
  }
  async function reorder(
    id: string,
    targetId: string,
    side: "before" | "after",
  ) {
    await action(async () => {
      const fresh = (await api(`/api/templates/${data.templateId}/workspace`))
        .data as WorkspaceData;
      // Do not silently accept another editor's order before applying a drag.
      if (
        fresh.version !== templateVersions.get(data.templateId) ||
        fresh.parent?.version !== data.parent?.version
      ) {
        accept(fresh);
        throw new Error(
          "The template changed. Review the latest order before trying again.",
        );
      }
      const previous = fresh,
        proposed = moveStep(fresh.steps, id, targetId, side);
      if (JSON.stringify(proposed) === JSON.stringify(fresh.steps)) return;
      setData({ ...fresh, steps: proposed });
      setContext(null);
      try {
        const result = await api(
          `/api/templates/${data.templateId}/order`,
          "PATCH",
          {
            movedItemId: id,
            expectedVersion: fresh.version,
            expectedParentVersion: fresh.parent?.version ?? null,
            expectedOrder: fresh.steps.map(stepOrder).map(orderEntry),
            proposedOrder: proposed.map(stepOrder).map(orderEntry),
          },
        );
        accept(result.data);
      } catch (failure) {
        setData(previous);
        throw failure;
      }
    });
  }
  function movement(step: WorkspaceStep, direction: number) {
    const index = ordered.findIndex((entry) => entry.id === step.id),
      target = ordered[index + direction];
    if (target)
      void reorder(step.id, target.id, direction < 0 ? "before" : "after");
  }
  function actions(step: WorkspaceStep): MenuAction[] {
    const index = ordered.findIndex((entry) => entry.id === step.id),
      editable = canEdit && !step.inherited && !busy;
    return [
      {
        label: "Move up",
        disabled: !editable || index === 0,
        onClick: () => movement(step, -1),
      },
      {
        label: "Move down",
        disabled: !editable || index === ordered.length - 1,
        onClick: () => movement(step, 1),
      },
      ...(data.scope === "organization" && !step.inherited
        ? [
            {
              label: "Move to start",
              disabled: !editable,
              onClick: () => reorder(step.id, "start", "after"),
            },
            {
              label: "Move to end",
              disabled: !editable,
              onClick: () => reorder(step.id, "end", "before"),
            },
          ]
        : []),
      {
        label: "Step history",
        onClick: () =>
          void action(async () =>
            setHistory({
              entities: [{ type: "template_item", id: step.id }],
              readOnly: step.inherited,
            }),
          ),
      },
      ...(step.inherited && data.parent
        ? [
            {
              label: "Open global template",
              onClick: () =>
                action(async () =>
                  router.push(`/templates/${data.parent!.id}`),
                ),
            },
          ]
        : []),
      {
        label: "Remove step",
        disabled: !editable,
        danger: true,
        onClick: () =>
          action(async () => {
            if (
              !window.confirm(
                step.kind === "global"
                  ? "Remove this standard step? Org-local steps anchored to it will remain unplaced until repaired."
                  : "Remove this local step? It will remain recoverable in template history.",
              )
            )
              return;
            await api(
              `/api/templates/${data.templateId}/items?itemId=${step.id}`,
              "DELETE",
            );
            await reload();
            setSelectedId("");
            setContext(null);
          }),
      },
    ];
  }
  async function addStep() {
    await action(async () => {
      const result = await api(
        `/api/templates/${data.templateId}/items`,
        "POST",
        {
          title:
            data.scope === "global"
              ? "Untitled standard step"
              : "Untitled local step",
          body: doc("Describe the work to complete."),
          ...(data.scope === "organization"
            ? {
                placement: selected?.inherited ? "after" : "end",
                anchorItemId: selected?.inherited ? selected.id : null,
              }
            : {}),
        },
      );
      await reload();
      setSelectedId(result.data.id);
      setContext(null);
    });
  }
  const templateActions: MenuAction[] = [
    {
      label: "Edit template details",
      disabled: !canEdit || busy,
      onClick: () =>
        void action(async () => {
          setName(data.templateName);
          setDescription(data.templateDescription);
          setDetails(true);
        }),
    },
    {
      label: "Template history",
      onClick: () =>
        void action(async () =>
          setHistory({
            entities: [{ type: "template_history", id: data.templateId }],
            readOnly: false,
          }),
        ),
    },
    {
      label: "Delete template",
      disabled: !canEdit || busy,
      danger: true,
      onClick: () =>
        action(async () => {
          if (
            !window.confirm(
              "Soft-delete this template? Existing frozen checklists remain unchanged.",
            )
          )
            return;
          await api(`/api/templates/${data.templateId}`, "DELETE");
          router.push(
            data.scope === "global"
              ? "/global-templates"
              : `/organizations/${data.organizationId}`,
          );
        }),
    },
  ];
  return (
    <WorkspaceShell
      user={user}
      active={data.scope === "global" ? "templates" : "organizations"}
      beforeNavigate={() => queue.flush()}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4">
        <div>
          <p className="text-xs text-slate-500">
            {data.scope === "global"
              ? "Global templates"
              : `Organizations / ${data.organizationName}`}
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            {data.templateName}{" "}
            <span className="text-xs font-normal text-teal-700">
              {busy
                ? "Working…"
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "saving"
                    ? "Saving…"
                    : "Save failed"}
            </span>
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            className={button}
            onClick={() =>
              void action(async () =>
                setHistory({
                  entities: [{ type: "template_history", id: data.templateId }],
                  readOnly: false,
                }),
              )
            }
          >
            <Clock3 size={14} className="mr-1 inline" />
            History
          </button>
          <button
            className={primary}
            disabled={!orgId || busy}
            onClick={() =>
              void action(async () => {
                const result = await api(
                  `/api/templates/${data.templateId}/context?organizationId=${orgId}`,
                );
                setContext(result.data);
                setPreview(true);
              })
            }
          >
            <Eye size={14} className="mr-1 inline" />
            Preview
          </button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}{" "}
          <button
            className="ml-3 underline"
            onClick={() => void action(reload)}
          >
            Refresh latest
          </button>
        </div>
      )}
      {saveState === "error" && (
        <div role="alert" className="m-5 rounded-xl bg-amber-50 p-4 text-sm">
          Your unsaved edits remain in this page.{" "}
          <button
            className="underline"
            onClick={() => void action(async () => {})}
          >
            Retry save
          </button>
          <button
            className="ml-4 underline"
            onClick={() => {
              if (
                window.confirm(
                  "Discard unsaved drafts and load the latest server version?",
                )
              ) {
                drafts.clear();
                queue.discard();
                void action(reload);
              }
            }}
          >
            Discard drafts and reload
          </button>
        </div>
      )}
      {data.parent && (
        <div className="mx-6 mt-5 rounded-xl border bg-teal-50 p-4 text-sm">
          Linked to{" "}
          <a
            href={`/templates/${data.parent.id}`}
            onClick={(event) => {
              event.preventDefault();
              void action(async () =>
                router.push(`/templates/${data.parent!.id}`),
              );
            }}
            className="font-semibold underline"
          >
            {data.parent.name}
          </a>{" "}
          · updates automatically. Inherited steps are read-only; local steps
          belong only to this template.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div
          role="tablist"
          aria-label="Template views"
          className="flex rounded-xl border bg-white p-1"
        >
          {["Canvas", "Variables", "Validation"].map((name, index) => (
            <button
              key={name}
              role="tab"
              id={`tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              className={`rounded-lg px-4 py-2 text-sm ${tab === name ? "bg-[#173f39] text-white" : "text-slate-500"}`}
              onClick={() => setTab(name)}
              onKeyDown={(event) => {
                if (
                  ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                  const names = ["Canvas", "Variables", "Validation"];
                  setTab(names[next]);
                  document.getElementById(`tab-${names[next]}`)?.focus();
                }
              }}
            >
              {name}
            </button>
          ))}
        </div>
        {data.scope === "global" ? (
          <label className="text-xs text-slate-500">
            Preview organization{" "}
            <select
              aria-label="Preview organization"
              value={orgId ?? ""}
              className="ml-2 rounded-xl border bg-white p-2"
              disabled={busy}
              onChange={(event) => {
                setOrgId(event.target.value || null);
                setContext(null);
              }}
            >
              <option value="">Choose organization</option>
              {data.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm text-slate-500">
            {data.organizationName}
          </span>
        )}
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
        <section
          className="min-w-0 px-6 pb-8"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === "Canvas" ? (
            <div className="overflow-hidden rounded-3xl border bg-[#fffef9] shadow-sm">
              <div className="flex items-start justify-between border-b p-6">
                <div>
                  <span className="text-xs text-teal-700">
                    {data.scope === "global"
                      ? "Global template"
                      : "Organization template"}
                  </span>
                  <h2 className="mt-2 text-xl font-semibold">
                    {data.templateName}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {data.templateDescription || "No description"}
                  </p>
                  <p className="mt-4 text-xs">
                    {orgId
                      ? context
                        ? context.valid
                          ? "Variables and template valid"
                          : "Review validation"
                        : "Validation unavailable"
                      : "Select an organization to validate"}{" "}
                    · {ordered.length} steps
                  </p>
                </div>
                <ActionMenu
                  label="Template actions"
                  actions={templateActions}
                />
              </div>
              <div className="space-y-3 p-5">
                <p className="text-[10px] uppercase tracking-widest text-slate-400">
                  Ordered steps · drag a handle or use move up/down
                </p>
                <DragDropProvider
                  onDragOver={(event) => {
                    const target = event.operation.target;
                    setDropHint(
                      target
                        ? `Drop at ${String(target.id) === "start" || String(target.id) === "end" ? String(target.id) : "the indicated step"}`
                        : "",
                    );
                  }}
                  onDragEnd={(event) => {
                    setDropHint("");
                    const source = event.operation.source,
                      target = event.operation.target;
                    if (
                      event.canceled ||
                      !source ||
                      !isSortable(source) ||
                      !canEdit
                    )
                      return;
                    if (
                      target &&
                      (target.id === "start" || target.id === "end")
                    ) {
                      void reorder(
                        String(source.id),
                        String(target.id),
                        target.id === "start" ? "after" : "before",
                      );
                      return;
                    }
                    if (source.index === source.initialIndex) return;
                    const destination = ordered[source.index];
                    if (destination)
                      void reorder(
                        String(source.id),
                        destination.id,
                        source.index > source.initialIndex ? "after" : "before",
                      );
                  }}
                >
                  {data.scope === "organization" && (
                    <DropZone id="start" disabled={!canEdit || busy} />
                  )}
                  {!ordered.length && (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No steps yet.{" "}
                      {data.scope === "organization"
                        ? "Add a local step or edit the linked global template."
                        : "Add a standard step to begin."}
                    </p>
                  )}
                  {ordered.map((step, index) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      index={index}
                      selected={selected?.id === step.id}
                      disabled={!canEdit || busy}
                      onSelect={() => setSelectedId(step.id)}
                      actions={actions(step)}
                      anchors={data.steps
                        .filter((row) => row.inherited)
                        .map((row) => row.id)}
                    />
                  ))}
                  {data.scope === "organization" && (
                    <DropZone id="end" disabled={!canEdit || busy} />
                  )}
                </DragDropProvider>
                {dropHint && (
                  <p
                    role="status"
                    className="rounded-lg border-2 border-dashed border-teal-500 p-2 text-xs text-teal-800"
                  >
                    {dropHint}
                  </p>
                )}
                {canEdit && (
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-teal-800"
                    disabled={busy}
                    onClick={addStep}
                  >
                    <Plus size={16} />
                    {data.scope === "global"
                      ? "Add standard step"
                      : "Add local step"}
                  </button>
                )}
              </div>
            </div>
          ) : !orgId ? (
            <p className="rounded-xl border bg-white p-6 text-sm">
              Choose an organization to inspect its stored variables and
              validation.
            </p>
          ) : !context ? (
            <p className="rounded-xl border bg-white p-6 text-sm">
              Organization context is unavailable. No successful validation was
              substituted.
            </p>
          ) : tab === "Variables" ? (
            <div className="space-y-4">
              {context.variables.map((value) => (
                <article
                  key={value.id}
                  className="rounded-xl border bg-white p-5"
                >
                  <h3 className="font-semibold">{value.label}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {value.status} ·{" "}
                    {value.used ? "used by this template" : "not used here"} ·{" "}
                    {value.syncedAt
                      ? new Date(value.syncedAt).toLocaleString()
                      : "not synchronized"}
                  </p>
                  <code className="mt-3 block text-xs">{`{{${value.key}}}`}</code>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">
                    {JSON.stringify(value.value, null, 2)}
                  </pre>
                  {value.issues.map((issue) => (
                    <p key={issue} className="mt-2 text-xs text-amber-800">
                      {issue}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-white p-6">
              <h2 className="font-semibold">
                {context.valid
                  ? "Ready to create a checklist"
                  : "Checklist creation blocked"}
              </h2>
              {context.valid ? (
                <p className="mt-2 text-sm text-slate-500">
                  Referenced variables and placement anchors passed validation.
                </p>
              ) : (
                <>
                  <ul className="mt-4 space-y-2">
                    {context.invalidVariables.map((key) => (
                      <li key={key} className="text-sm text-red-700">
                        Invalid variable: {key}
                      </li>
                    ))}
                    {context.issues.map((issue, index) => (
                      <li key={index}>
                        <button
                          className="text-left text-sm text-red-700 underline"
                          onClick={() => {
                            setSelectedId(issue.itemId);
                            setTab("Canvas");
                          }}
                        >
                          {
                            data.steps.find((step) => step.id === issue.itemId)
                              ?.title
                          }
                          : {issue.code}
                          {issue.variableKey ? ` — ${issue.variableKey}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
        <aside className="border-l bg-white p-5">
          <div className="flex justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400">
                Step inspector
              </p>
              <p className="mt-2 text-sm font-semibold">
                {selected
                  ? `Step ${ordered.findIndex((step) => step.id === selected.id) + 1}`
                  : "Select a step"}
              </p>
            </div>
            {selected && (
              <ActionMenu
                label="Selected step actions"
                actions={actions(selected)}
              />
            )}
          </div>
          {selected && (
            <div className="mt-5 space-y-5">
              {selected.inherited && (
                <p className="flex gap-2 rounded-xl bg-teal-50 p-3 text-xs">
                  <LockKeyhole size={16} />
                  Inherited from {data.parent?.name}. Open the global template
                  to edit.
                </p>
              )}
              <label className="block text-xs">
                Step title
                <input
                  aria-label="Step title"
                  className="mt-2 w-full rounded-xl border p-3"
                  disabled={!owned}
                  value={selected.title}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <div>
                <p className="mb-2 text-xs">Instructions</p>
                <RichTextEditor
                  key={selected.id}
                  value={selected.body}
                  editable={!!owned}
                  onChange={(body) => update({ body })}
                  onInsertVariable={() => setVariable(true)}
                />
              </div>
              <RepeatControl
                value={selected.repeatVariableId}
                definitions={data.definitions}
                disabled={!owned}
                onChange={(repeatVariableId) => update({ repeatVariableId })}
              />
              <RepeatedFieldHelp
                definition={data.definitions.find(
                  (definition) => definition.id === selected.repeatVariableId,
                )}
              />
              <p className="rounded-xl border p-3 text-xs">
                {selected.inherited
                  ? "Live inheritance: global changes flow into this org template."
                  : selected.kind === "org"
                    ? "Local to this org template; never added to a reusable library."
                    : "Owned by this global template."}
              </p>
              {selected.kind === "org" && (
                <label className="block text-xs">
                  Placement
                  <select
                    aria-label="Local step placement"
                    className="mt-2 w-full rounded-xl border p-2"
                    value={
                      selected.placement === "start" ||
                      selected.placement === "end"
                        ? selected.placement
                        : `${selected.placement}:${selected.anchorItemId}`
                    }
                    disabled={!owned || busy}
                    onChange={(event) => {
                      const [side, id] = event.target.value.split(":");
                      void reorder(
                        selected.id,
                        id ?? side,
                        side === "before" ? "before" : "after",
                      );
                    }}
                  >
                    <option value="start">Start of checklist</option>
                    <option value="end">End of checklist</option>
                    {data.steps
                      .filter((step) => step.inherited)
                      .flatMap((step) => [
                        <option
                          key={`before:${step.id}`}
                          value={`before:${step.id}`}
                        >
                          Before: {step.title}
                        </option>,
                        <option
                          key={`after:${step.id}`}
                          value={`after:${step.id}`}
                        >
                          After: {step.title}
                        </option>,
                      ])}
                    {selected.anchorItemId &&
                      !data.steps.some(
                        (step) =>
                          step.inherited && step.id === selected.anchorItemId,
                      ) && (
                        <option
                          value={`${selected.placement}:${selected.anchorItemId}`}
                        >
                          Missing anchor — choose a new placement
                        </option>
                      )}
                  </select>
                </label>
              )}
            </div>
          )}
        </aside>
      </div>
      {variable && selected && owned && (
        <VariableTokenPicker
          definitions={data.definitions}
          repeatVariableId={selected.repeatVariableId}
          onClose={() => setVariable(false)}
          onInsert={(key) => {
            update({
              body: {
                ...selected.body,
                content: [
                  ...(selected.body.content ?? []),
                  ...doc(`{{${key}}}`).content,
                ],
              },
            });
            setVariable(false);
          }}
        />
      )}
      {history && (
        <HistoryDialog
          entities={history.entities}
          canEdit={canEdit && !history.readOnly}
          onClose={() => setHistory(null)}
          onRestored={async () => {
            await queue.flush();
            await reload();
            setContext(null);
          }}
        />
      )}
      {preview && (
        <Modal
          title={`Organization preview — ${data.organizations.find((org) => org.id === orgId)?.name ?? "Unavailable"}`}
          onClose={() => setPreview(false)}
        >
          {!context?.valid ? (
            <p className="rounded-xl bg-amber-50 p-4 text-sm">
              Preview blocked. Review Validation.
            </p>
          ) : (
            <ol className="space-y-5">
              {context.steps.map((step, index) => (
                <li key={`${step.sourceItemId}:${step.repeatIndex ?? 0}`}>
                  <h3 className="text-sm font-semibold">
                    {index + 1}. {step.title}
                  </h3>
                  <RichInstructions value={step.body} />
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
      {details && (
        <Modal title="Edit template details" onClose={() => setDetails(false)}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await api(`/api/templates/${data.templateId}`, "PATCH", {
                  name,
                  description,
                  expectedVersion: templateVersions.get(data.templateId),
                });
                await reload();
                setDetails(false);
              });
            }}
          >
            <label className="block text-sm">
              Name
              <input
                required
                maxLength={160}
                value={name}
                className="mt-2 w-full rounded-xl border p-3"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              Description
              <textarea
                maxLength={2000}
                value={description}
                className="mt-2 w-full rounded-xl border p-3"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <button className={primary} disabled={busy}>
              Save details
            </button>
          </form>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
function DropZone({
  id,
  disabled,
}: {
  id: "start" | "end";
  disabled: boolean;
}) {
  const { ref, isDropTarget } = useDroppable({ id, disabled });
  return (
    <div
      ref={ref}
      className={`rounded-xl border border-dashed p-3 text-center text-xs ${isDropTarget ? "border-teal-500 bg-teal-50" : "text-slate-400"}`}
    >
      Drop a local step at the {id}
    </div>
  );
}
function StepRow({
  step,
  index,
  selected,
  disabled,
  onSelect,
  actions,
  anchors,
}: {
  step: WorkspaceStep;
  index: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  actions: MenuAction[];
  anchors: string[];
}) {
  const { ref, handleRef, isDragSource, isDropTarget } = useSortable({
    id: step.id,
    index,
    disabled: { draggable: disabled || step.inherited, droppable: disabled },
  });
  const missing =
    step.kind === "org" &&
    step.placement !== "start" &&
    step.placement !== "end" &&
    (!step.anchorItemId || !anchors.includes(step.anchorItemId));
  return (
    <div
      ref={ref}
      data-step-id={step.id}
      className={`grid grid-cols-[24px_32px_minmax(0,1fr)_auto] items-start gap-2 rounded-2xl border p-4 ${selected ? "border-[#6ebeb2] bg-[#f2fbf8]" : "border-transparent bg-white"} ${isDragSource ? "opacity-50" : ""} ${isDropTarget ? "ring-2 ring-teal-500" : ""}`}
    >
      <button
        ref={handleRef}
        aria-label={`Drag step ${index + 1}: ${step.title}`}
        disabled={disabled || step.inherited}
        className="mt-2 touch-none cursor-grab text-slate-400 disabled:cursor-default disabled:opacity-30"
      >
        <GripVertical size={16} />
      </button>
      <span className="grid size-8 place-items-center rounded-full bg-[#e2f1ed] text-xs font-bold text-teal-800">
        {index + 1}
      </span>
      <button className="min-w-0 text-left" onClick={onSelect}>
        <span className="text-sm font-semibold">{step.title}</span>
        <span className="ml-2 inline-block rounded-full border px-2 py-1 text-[10px] text-teal-800">
          {step.inherited
            ? "Inherited"
            : step.kind === "org"
              ? "Local"
              : "Standard"}
        </span>
        {step.repeatVariableId && (
          <span className="ml-2 text-xs text-lime-800">Repeats</span>
        )}
        <span className="mt-2 block line-clamp-2 text-xs text-slate-500">
          {textOf(step.body)}
        </span>
        {missing && (
          <span className="mt-2 block text-xs text-red-700">
            Unplaced — choose a new anchor or move to start/end
          </span>
        )}
      </button>
      <ActionMenu label={`Step ${index + 1} actions`} actions={actions} />
    </div>
  );
}
