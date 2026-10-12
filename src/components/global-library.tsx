"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Layers3 } from "lucide-react";
import type {
  LibraryStep,
  VariableDefinitionSummary,
  WorkspaceUser,
} from "@/lib/workspace-types";
import { RichTextEditor } from "./rich-text-editor";
import {
  WorkspaceShell,
  ActionMenu,
  HistoryDialog,
  RepeatControl,
  api,
  doc,
  useSaves,
  MutationGate,
} from "./workspace-ui";

export function GlobalLibrary({
  initialSteps,
  definitions,
  selectedStepId,
  user,
  demo = false,
}: {
  initialSteps: LibraryStep[];
  definitions: VariableDefinitionSummary[];
  selectedStepId?: string;
  user: WorkspaceUser;
  demo?: boolean;
}) {
  const [steps, setSteps] = useState<LibraryStep[]>(
    demo
      ? [
          {
            id: "demo-step",
            title: "Example global step",
            body: doc("Global instructions shared across templates."),
            repeatVariableId: null,
            references: [],
          },
        ]
      : initialSteps,
  );
  const [selectedId, setSelectedId] = useState(
      selectedStepId ?? steps[0]?.id ?? "",
    ),
    [search, setSearch] = useState(""),
    [deleted, setDeleted] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<{ type: string; id: string }[] | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const { state, queue } = useSaves();
  const [gate] = useState(() => new MutationGate());
  const router = useRouter();
  const canEdit = user.role !== "viewer";
  const visible = steps.filter(
    (s) =>
      !!s.deletedAt === deleted &&
      s.title.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = steps.find((s) => s.id === selectedId);
  async function refresh() {
    if (demo) return;
    const result = await api("/api/global-library");
    setSteps(result.data.steps);
  }
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
  function update(change: Partial<LibraryStep>) {
    if (!selected || !canEdit || selected.deletedAt) return;
    const next = { ...selected, ...change };
    setSteps((rows) => rows.map((s) => (s.id === selected.id ? next : s)));
    if (!demo)
      queue.schedule(
        `global:${selected.id}`,
        `/api/global-steps/${selected.id}`,
        {
          title: next.title,
          body: next.body,
          repeatVariableId: next.repeatVariableId,
        },
      );
  }
  return (
    <WorkspaceShell
      user={user}
      active="library"
      counts={{
        library: steps.filter((s) => !s.deletedAt).length,
        variables: definitions.length,
      }}
      beforeNavigate={() => queue.flush()}
    >
      <header className="flex min-h-[76px] items-center justify-between border-b bg-white px-7">
        <div>
          <p className="text-[11px] text-slate-500">
            Workspace / Global library
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            Global library{" "}
            <span className="text-[10px] text-teal-700">
              {demo ? "Demo · browser only" : state}
            </span>
          </h1>
        </div>
        {canEdit && (
          <button
            disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs text-white"
            onClick={() =>
              void action(async () => {
                const item = demo
                  ? {
                      id: `demo-${Date.now()}`,
                      title: "Untitled global step",
                      body: doc("Describe the work to complete."),
                      repeatVariableId: null,
                    }
                  : (
                      await api("/api/global-steps", "POST", {
                        title: "Untitled global step",
                        body: doc("Describe the work to complete."),
                      })
                    ).data;
                setSteps((rows) => [...rows, { ...item, references: [] }]);
                setSelectedId(item.id);
                setDeleted(false);
                setSearch("");
              })
            }
          >
            <Plus size={15} />
            New global step
          </button>
        )}
      </header>
      {error && (
        <p
          role="alert"
          className="m-5 rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {state === "error" && (
        <button
          className="m-5 rounded-lg border p-3 text-xs"
          onClick={() => void action(async () => queue.flush())}
        >
          Retry unsaved changes
        </button>
      )}
      <div className="grid gap-6 p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-2xl border bg-white p-4">
          <input
            aria-label="Search global steps"
            placeholder="Search global steps"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border p-3 text-xs"
          />
          <label className="my-4 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={deleted}
              onChange={(e) => {
                setDeleted(e.target.checked);
                setSelectedId("");
              }}
            />
            Show deleted steps
          </label>
          <div className="space-y-2">
            {visible.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full rounded-xl border p-3 text-left ${s.id === selectedId ? "border-teal-300 bg-teal-50" : "border-transparent hover:bg-slate-50"}`}
              >
                <span className="block text-sm font-semibold">{s.title}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {s.references.length} template(s)
                  {s.repeatVariableId ? " · repeats" : ""}
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="p-3 text-sm text-slate-500">
                No matching {deleted ? "deleted" : "active"} steps.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border bg-white p-6">
          {selected ? (
            <>
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-xs font-semibold text-teal-800">
                  <Layers3 size={16} />
                  {selected.deletedAt
                    ? "Deleted global step"
                    : "Live global step"}
                </p>
                <ActionMenu
                  label="Global step actions"
                  actions={[
                    {
                      label: "Version history",
                      disabled: demo,
                      onClick: () =>
                        action(async () =>
                          setHistory([
                            { type: "global_step", id: selected.id },
                          ]),
                        ),
                    },
                    {
                      label: selected.references.length
                        ? "Delete unavailable: used by templates"
                        : "Delete global step",
                      danger: true,
                      disabled:
                        !canEdit ||
                        busy ||
                        !!selected.deletedAt ||
                        selected.references.length > 0,
                      onClick: () =>
                        action(async () => {
                          if (
                            !window.confirm(
                              "Soft-delete this global step? It can be restored from history.",
                            )
                          )
                            return;
                          if (!demo)
                            await api(
                              `/api/global-steps/${selected.id}`,
                              "DELETE",
                            );
                          setSteps((rows) =>
                            rows.map((s) =>
                              s.id === selected.id
                                ? { ...s, deletedAt: new Date().toISOString() }
                                : s,
                            ),
                          );
                          setDeleted(true);
                        }),
                    },
                  ]}
                />
              </div>
              <label className="mt-5 block text-xs">
                Step title
                <input
                  aria-label="Global step title"
                  disabled={!canEdit || !!selected.deletedAt}
                  value={selected.title}
                  onChange={(e) => update({ title: e.target.value })}
                  className="mt-2 w-full rounded-xl border p-3 text-sm"
                />
              </label>
              <div className="mt-5">
                <p className="mb-2 text-xs">Instructions</p>
                <RichTextEditor
                  key={selected.id}
                  value={selected.body}
                  editable={canEdit && !selected.deletedAt}
                  onChange={(body) => update({ body })}
                  onInsertVariable={() => {
                    const key = window.prompt(
                      "Variable token",
                      definitions[0]?.key ?? "org.ad_full_name",
                    );
                    if (key)
                      update({
                        body: {
                          ...selected.body,
                          content: [
                            ...(selected.body.content ?? []),
                            ...doc(`{{${key}}}`).content,
                          ],
                        },
                      });
                  }}
                />
              </div>
              <div className="mt-5">
                <RepeatControl
                  value={selected.repeatVariableId}
                  definitions={definitions}
                  disabled={!canEdit || !!selected.deletedAt}
                  onChange={(repeatVariableId) => update({ repeatVariableId })}
                />
              </div>
              <div className="mt-6 rounded-xl bg-teal-50 p-4">
                <h2 className="text-xs font-semibold">
                  Used by {selected.references.length} template(s)
                </h2>
                <p className="mt-2 text-xs text-slate-600">
                  Edits appear in these templates when they load or preview the
                  current library step.
                </p>
                {selected.references.map((t) => (
                  <a
                    key={t.id}
                    href={`/?templateId=${t.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      void action(async () =>
                        router.push(`/?templateId=${t.id}`),
                      );
                    }}
                    className="mt-2 block text-xs text-teal-800 underline"
                  >
                    {t.name}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Select a global step to view its instructions and usage.
            </p>
          )}
        </section>
      </div>
      {history && (
        <HistoryDialog
          entities={history}
          canEdit={canEdit}
          onClose={() => setHistory(null)}
          onRestored={async () => {
            await refresh();
            setDeleted(false);
          }}
        />
      )}
    </WorkspaceShell>
  );
}
