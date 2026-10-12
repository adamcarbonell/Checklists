"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ActivityEntry,
  ChecklistDetail,
  ChecklistStep,
  WorkspaceUser,
} from "@/lib/workspace-types";
import {
  WorkspaceShell,
  Modal,
  TextPrompt,
  ActionMenu,
  MutationGate,
  api,
} from "./workspace-ui";
import { RichInstructions } from "./rich-instructions";
type Draft = { value: string; expectedVersion: number };
export function ChecklistRun({
  initial,
  user,
}: {
  initial: ChecklistDetail;
  user: WorkspaceUser;
}) {
  const router = useRouter(),
    [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [skipId, setSkipId] = useState<string | null>(null),
    [activity, setActivity] = useState<{
      data: ActivityEntry[];
      page: number;
      hasMore: boolean;
    } | null>(null),
    [page, setPage] = useState(1),
    [gate] = useState(() => new MutationGate());
  async function fetchLatest() {
    const result = await api(
      `/api/checklists/${data.id}${user.role === "admin" ? "?includeDeleted=true" : ""}`,
    );
    setData(result.data);
    return result.data as ChecklistDetail;
  }
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [drafts]);
  async function send(
    current: ChecklistDetail,
    id: string,
    changes: {
      status?: ChecklistStep["status"];
      skipReason?: string;
      notes?: string;
    },
  ) {
    const step = current.steps.find((entry) => entry.id === id)!;
    const draft = drafts[id],
      notes = changes.notes ?? draft?.value;
    const result = await api(
      `/api/checklists/${data.id}/steps/${id}`,
      "PATCH",
      {
        ...changes,
        ...(notes !== undefined ? { notes } : {}),
        expectedVersion: draft?.expectedVersion ?? step.version,
      },
    );
    if (notes !== undefined)
      setDrafts((previous) => {
        const next = { ...previous };
        if (next[id]?.value === notes) delete next[id];
        return next;
      });
    setData(result.data);
    return result.data as ChecklistDetail;
  }
  async function flushNotes() {
    let current = data;
    for (const [id, draft] of Object.entries(drafts))
      current = await send(current, id, { notes: draft.value });
    return current;
  }
  async function action(
    work: (current: ChecklistDetail) => Promise<void>,
    flush = false,
  ) {
    if (!gate.enter()) return;
    setBusy(true);
    setError("");
    try {
      const current = flush ? await flushNotes() : data;
      await work(current);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      gate.leave();
      setBusy(false);
    }
  }
  async function beforeNavigate() {
    if (!gate.enter()) throw new Error("Wait for the current save to finish.");
    setBusy(true);
    try {
      await flushNotes();
    } finally {
      gate.leave();
      setBusy(false);
    }
  }
  async function history(historyPage = 1) {
    const result = await api(
      `/api/checklists/${data.id}/activity?page=${historyPage}`,
    );
    setActivity(result);
  }
  const visible = data.steps.slice((page - 1) * 50, page * 50);
  const terminal = data.completed + data.skipped;
  return (
    <WorkspaceShell
      user={user}
      active="checklists"
      beforeNavigate={beforeNavigate}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-5">
        <div>
          <p className="text-xs text-slate-500">
            {data.organizationName} / {data.templateName}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{data.name}</h1>
          <p className="mt-2 text-xs text-slate-500">
            Frozen at creation · org template v{data.templateVersion} · global
            template v{data.globalTemplateVersion}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            className="rounded-xl border px-3 py-2 text-sm"
            onClick={() =>
              void action(async () => {
                await fetchLatest();
              })
            }
          >
            Refresh
          </button>
          <button
            disabled={busy}
            className="rounded-xl border px-3 py-2 text-sm"
            onClick={() => void action(async () => history())}
          >
            Activity
          </button>
          {user.role === "admin" && (
            <ActionMenu
              label="Checklist actions"
              actions={[
                {
                  label: data.deletedAt
                    ? "Restore checklist"
                    : "Delete checklist",
                  danger: !data.deletedAt,
                  disabled: busy,
                  onClick: () =>
                    action(async () => {
                      if (
                        !window.confirm(
                          data.deletedAt
                            ? "Restore this frozen checklist?"
                            : "Soft-delete this checklist? An administrator can restore it.",
                        )
                      )
                        return;
                      await api(
                        `/api/checklists/${data.id}${data.deletedAt ? "/restore" : ""}`,
                        data.deletedAt ? "POST" : "DELETE",
                      );
                      if (data.deletedAt) await fetchLatest();
                      else router.push("/");
                    }, true),
                },
              ]}
            />
          )}
        </div>
      </header>
      <div className="space-y-5 p-6">
        <section className="rounded-2xl border bg-white p-5">
          <div className="flex justify-between gap-3 text-sm">
            <span className="font-semibold">
              {data.deletedAt
                ? "Deleted checklist"
                : data.status === "completed"
                  ? "Finished"
                  : "In progress"}
            </span>
            <span>
              {data.completed} completed · {data.skipped} skipped · {data.total}{" "}
              total
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={
                data.skipped ? "h-full bg-amber-500" : "h-full bg-teal-600"
              }
              style={{
                width: `${data.total ? (terminal / data.total) * 100 : 0}%`,
              }}
            />
          </div>
        </section>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
          >
            {error} Your unsaved notes remain here. Refresh to review the latest
            state.
          </p>
        )}
        {data.deletedAt && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm">
            This checklist is read-only until an administrator restores it.
          </p>
        )}
        {visible.map((step) => (
          <article key={step.id} className="rounded-2xl border bg-white p-5">
            <div className="flex items-start gap-3">
              <input
                aria-label={`Complete step ${step.position}: ${step.title}`}
                type="checkbox"
                checked={step.status === "completed"}
                disabled={busy || !!data.deletedAt}
                className="mt-1 size-5 accent-teal-700"
                onChange={(event) => {
                  const status = event.target.checked ? "completed" : "pending";
                  void action(async (current) => {
                    await send(current, step.id, { status });
                  });
                }}
              />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">
                  {step.position}. {step.title}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {step.status}
                  {step.statusChangedAt
                    ? ` · ${data.people[step.statusChangedBy ?? ""] ?? "Team member"} · ${new Date(step.statusChangedAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <button
                disabled={busy || !!data.deletedAt}
                className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40"
                onClick={() => setSkipId(step.id)}
              >
                {step.status === "skipped" ? "Edit skip reason" : "Skip"}
              </button>
              {step.status === "skipped" && (
                <button
                  disabled={busy || !!data.deletedAt}
                  className="rounded-lg border px-3 py-2 text-xs"
                  onClick={() =>
                    void action(async (current) => {
                      await send(current, step.id, { status: "pending" });
                    })
                  }
                >
                  Reopen
                </button>
              )}
            </div>
            <div className="ml-8 mt-4">
              <RichInstructions value={step.body} />
            </div>
            {step.status === "skipped" && (
              <p className="ml-8 mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Skipped: {step.skipReason}
              </p>
            )}
            <div className="ml-8 mt-5">
              <label className="block text-xs text-slate-500">
                Step notes
                <textarea
                  aria-label={`Notes for step ${step.position}`}
                  maxLength={2000}
                  rows={2}
                  disabled={busy || !!data.deletedAt}
                  value={drafts[step.id]?.value ?? step.notes}
                  className="mt-2 w-full rounded-xl border p-3 text-sm"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [step.id]: {
                        value: event.target.value,
                        expectedVersion:
                          current[step.id]?.expectedVersion ?? step.version,
                      },
                    }))
                  }
                />
              </label>
              <p className="mt-1 text-[10px] text-slate-400">
                Do not enter passwords or API keys. Maximum 2,000 characters.
              </p>
              {drafts[step.id] && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {drafts[step.id].expectedVersion !== step.version ? (
                    <>
                      <span className="text-amber-800">
                        This step changed while you were editing. Compare your
                        notes with the latest saved notes:{" "}
                        {step.notes || "(empty)"}
                      </span>
                      <button
                        className="underline"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Replace the latest saved notes with your draft on the next save?",
                            )
                          )
                            setDrafts((current) => ({
                              ...current,
                              [step.id]: {
                                ...current[step.id],
                                expectedVersion: step.version,
                              },
                            }));
                        }}
                      >
                        Use my draft
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={busy}
                      className="text-teal-800 underline"
                      onClick={() =>
                        void action(async (current) => {
                          await send(current, step.id, {
                            notes: drafts[step.id].value,
                          });
                        })
                      }
                    >
                      Save notes
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className="underline"
                    onClick={() =>
                      setDrafts((current) => {
                        const next = { ...current };
                        delete next[step.id];
                        return next;
                      })
                    }
                  >
                    Discard draft
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
        {data.total > 50 && (
          <div className="flex justify-between text-sm">
            <button
              disabled={page <= 1 || busy}
              className="rounded-lg border px-3 py-2"
              onClick={() => void action(async () => setPage(page - 1), true)}
            >
              Previous steps
            </button>
            <span>Steps page {page}</span>
            <button
              disabled={page * 50 >= data.total || busy}
              className="rounded-lg border px-3 py-2"
              onClick={() => void action(async () => setPage(page + 1), true)}
            >
              Next steps
            </button>
          </div>
        )}
        <details className="rounded-xl border bg-white p-4">
          <summary className="cursor-pointer text-sm">
            Frozen variable values
          </summary>
          <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(data.variableSnapshot, null, 2)}
          </pre>
        </details>
      </div>
      {skipId && (
        <TextPrompt
          title="Skip step"
          label="Reason for skipping"
          initialValue={
            data.steps.find((step) => step.id === skipId)?.skipReason ?? ""
          }
          maxLength={2000}
          submitLabel="Save skip reason"
          errorMessage={error}
          onClose={() => setSkipId(null)}
          onSubmit={async (reason) => {
            await action(async (current) => {
              await send(current, skipId, {
                status: "skipped",
                skipReason: reason,
              });
              setSkipId(null);
            });
          }}
        />
      )}
      {activity && (
        <Modal title="Checklist activity" onClose={() => setActivity(null)}>
          <div className="space-y-4">
            {activity.data.map((entry) => (
              <article key={entry.id} className="rounded-xl border p-4">
                <p className="text-sm font-semibold">
                  {entry.actor} · {entry.event.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.stepId
                    ? ` · step ${data.steps.find((step) => step.id === entry.stepId)?.position ?? "unavailable"}`
                    : ""}
                </p>
                {Object.keys(entry.changes).length > 0 && (
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(entry.changes, null, 2)}
                  </pre>
                )}
              </article>
            ))}
            {!activity.data.length && (
              <p className="text-sm text-slate-500">No activity recorded.</p>
            )}
            <div className="flex justify-between">
              <button
                disabled={activity.page <= 1 || busy}
                className="rounded-lg border px-3 py-2 text-xs"
                onClick={() =>
                  void action(async () => history(activity.page - 1))
                }
              >
                Previous
              </button>
              <button
                disabled={!activity.hasMore || busy}
                className="rounded-lg border px-3 py-2 text-xs"
                onClick={() =>
                  void action(async () => history(activity.page + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
