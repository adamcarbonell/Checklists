"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Folder, GripVertical, Plus } from "lucide-react";
import type {
  ChecklistFolder,
  ChecklistSummary,
  TemplateSummary,
  WorkspaceUser,
} from "@/lib/workspace-types";
import { WorkspaceShell, Modal, TextPrompt, ActionMenu, MutationGate, api } from "./workspace-ui";
import { ChecklistDeleteDialog } from "./checklist-delete-dialog";
import { OrganizationWorkspaceTitle } from "./organization-workspace-title";
import { checklistPath, organizationPath } from "@/lib/organization-paths";
type Listing = {
  data: ChecklistSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export function ChecklistBoard({
  initial,
  organization,
  folders,
  folder,
  templates,
  user,
  logoVersion = null,
}: {
  initial: Listing;
  organization: { id: string; name: string };
  folders: ChecklistFolder[];
  folder?: ChecklistFolder;
  templates: TemplateSummary[];
  user: WorkspaceUser;
  logoVersion?: string | null;
}) {
  const router = useRouter();
  const canEdit = user.role !== "viewer";
  const orgPath = organizationPath(organization.id);
  const apiPath = `/api${orgPath}`;
  const [folderRows, setFolderRows] = useState(folders);
  const [editingFolder, setEditingFolder] = useState<ChecklistFolder | "new" | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [listing, setListing] = useState(initial),
    [filters, setFilters] = useState({
      status: "",
      search: "",
      page: 1,
      includeDeleted: false,
    }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false),
    [destinationId, setDestinationId] = useState(folder?.id ?? ""),
    [templateId, setTemplateId] = useState(""),
    [name, setName] = useState(""),
    [creationKey, setCreationKey] = useState(""),
    [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState<"move" | "delete" | null>(null);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [batchError, setBatchError] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [batchGate] = useState(() => new MutationGate());
  const draggedChecklist = useRef<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const folderId = folder?.id ?? null;
  const movableFolders = folderRows
    .filter((entry) => entry.id !== folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectableIds = listing.data.filter((row) => !row.deletedAt).map((row) => row.id);
  const selectedIds = selectableIds.filter((id) => selected.includes(id));
  const canMove = canEdit && movableFolders.length > 0;
  const canSelect = canMove || user.role === "admin";
  const choices = templates.filter((template) =>
    template.scope === "organization" && template.organizationId === organization.id && !template.deletedAt,
  );
  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(filters.page) });
      if (folder) params.set("folderId", folder.id);
      if (filters.status) params.set("status", filters.status);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.includeDeleted) params.set("includeDeleted", "true");
      void api(`${apiPath}/checklists?${params}`)
        .then((result) => {
          if (!canceled) {
            setListing(result);
            setLoading(false);
            setError("");
          }
        })
        .catch((failure) => {
          if (!canceled) {
            setError((failure as Error).message);
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [filters, apiPath, folder]);
  function filter(change: Partial<typeof filters>) {
    setSelected([]);
    setBatchStatus("");
    setBatchError("");
    setLoading(true);
    setFilters((current) => ({
      ...current,
      ...change,
      page: change.page ?? 1,
    }));
  }
  function openBatch(action: "move" | "delete") {
    setBatchError("");
    setMoveFolderId("");
    setBatch(action);
  }
  function endDrag() {
    draggedChecklist.current = null;
    setDropFolderId(null);
  }
  async function submitBatch(
    checklistIds: string[],
    change: { action: "move"; folderId: string } | { action: "delete" },
  ) {
    if (!checklistIds.length || loading || !batchGate.enter()) return;
    setBatchBusy(true);
    setBatchError("");
    setBatchStatus("");
    try {
      await api(`${apiPath}/checklists/bulk`, "POST", {
        ...change, checklistIds, expectedFolderId: folderId,
      });
      setBatch(null);
      filter({});
      const quantity = checklistIds.length === 1 ? "1 checklist" : `${checklistIds.length} checklists`;
      const destination = change.action === "move" ? folderRows.find((entry) => entry.id === change.folderId) : undefined;
      setBatchStatus(destination ? `Moved ${quantity} to ${destination.name}.` : `Deleted ${quantity}.`);
    } catch (failure) {
      setBatchError((failure as Error).message);
    } finally {
      batchGate.leave();
      setBatchBusy(false);
    }
  }
  function newChecklist() {
    const first = choices[0];
    setDestinationId(folder?.id ?? "");
    setTemplateId(first?.id ?? "");
    setName(first?.name ?? "");
    setCreationKey(crypto.randomUUID());
    setCreateError("");
    setCreating(true);
  }
  async function removeFolder(entry: ChecklistFolder) {
    if (!window.confirm(`Delete the empty folder “${entry.name}”?`)) return;
    setFolderBusy(true);
    setFolderError("");
    try {
      await api(`${apiPath}/folders/${entry.id}`, "DELETE");
      setFolderRows((current) => current.filter((item) => item.id !== entry.id));
    } catch (failure) {
      setFolderError((failure as Error).message);
    } finally {
      setFolderBusy(false);
    }
  }
  return (
    <WorkspaceShell user={user} active="organizations">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-5">
        <div>
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap gap-2 text-xs text-slate-600">
            <Link href="/organizations" className="underline">Organizations</Link>
            {folder && <><span aria-hidden="true">/</span><Link href={orgPath} className="underline">{organization.name}</Link></>}
          </nav>
          {folder ? <h1 className="text-xl font-semibold">{folder.name}</h1> : (
            <OrganizationWorkspaceTitle organization={organization} initialLogoVersion={logoVersion} canManageLogo={user.role === "admin"} />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
        {!folder && canEdit && <Link href={`${orgPath}/templates`} className="rounded-xl border px-4 py-2 text-sm">Open organization templates</Link>}
        <button
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={!choices.length || !(folder || folderRows.length) || folderBusy}
          onClick={newChecklist}
        >
          New checklist
        </button>
        </div>
      </header>
      <div className="space-y-5 p-6">
        {(!folder || canMove) && (
          <section aria-labelledby="organization-folders" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="organization-folders" className="font-semibold">Folders</h2>
              {!folder && canEdit && <button type="button" disabled={folderBusy} onClick={() => setEditingFolder("new")} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"><Plus size={16} /> New folder</button>}
            </div>
            {folderError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{folderError}</p>}
            {folderRows.length ? (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[...folderRows].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => (
                  <li
                    key={entry.id}
                    className={`flex min-w-0 items-center rounded-xl border p-2 ${dropFolderId === entry.id ? "border-teal-600 bg-teal-50 ring-2 ring-teal-500" : "bg-white"}`}
                    onDragOver={(event) => {
                      if (!canMove || !draggedChecklist.current || entry.id === folderId || loading || batchBusy) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropFolderId(entry.id);
                    }}
                    onDragLeave={(event) => {
                      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                      setDropFolderId((current) => current === entry.id ? null : current);
                    }}
                    onDrop={(event) => {
                      const id = draggedChecklist.current;
                      if (!canMove || !id || entry.id === folderId) return;
                      event.preventDefault();
                      endDrag();
                      void submitBatch([id], { action: "move", folderId: entry.id });
                    }}
                  >
                    <Link href={organizationPath(organization.id, entry.id)} aria-current={entry.id === folderId ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-teal-900 hover:bg-teal-50 aria-[current=page]:bg-teal-50">
                      <Folder size={18} className="shrink-0" aria-hidden="true" /><span className="break-words min-w-0">{entry.name}</span>
                    </Link>
                    {!folder && canEdit && <ActionMenu label={`Actions for ${entry.name}`} actions={[
                      { label: "Rename folder", disabled: folderBusy, onClick: () => { setFolderError(""); setEditingFolder(entry); } },
                      { label: "Delete empty folder", danger: true, disabled: folderBusy, onClick: () => removeFolder(entry) },
                    ]} />}
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-xl border bg-white p-4 text-sm">{canEdit ? "Create a folder to start filing checklists." : "An editor can create a folder for this organization."}</p>}
          </section>
        )}
        <h2 className="font-semibold">{folder ? "Checklists" : "Unfiled checklists"}</h2>
        {!choices.length && (
          <p className="rounded-xl border bg-white p-5 text-sm">
            Link an organization template before starting a checklist.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <input
            aria-label="Search checklists"
            maxLength={160}
            className="min-w-60 flex-1 rounded-xl border bg-white p-3 text-sm"
            value={filters.search}
            disabled={batchBusy}
            placeholder="Search checklist name"
            onChange={(event) => filter({ search: event.target.value })}
          />
          <select
            aria-label="Filter status"
            className="rounded-xl border bg-white p-3 text-sm"
            value={filters.status}
            disabled={batchBusy}
            onChange={(event) => filter({ status: event.target.value })}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="">All statuses</option>
          </select>
          {user.role === "admin" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.includeDeleted}
                disabled={batchBusy}
                onChange={(event) =>
                  filter({ includeDeleted: event.target.checked })
                }
              />
              Include deleted
            </label>
          )}
        </div>
        {batchStatus && <p role="status" className="text-sm text-teal-800">{batchStatus}</p>}
        {!batch && batchError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{batchError}</p>}
        {canSelect && selectableIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedIds.length === selectableIds.length}
                ref={(input) => { if (input) input.indeterminate = selectedIds.length > 0 && selectedIds.length < selectableIds.length; }}
                disabled={loading || batchBusy}
                onChange={(event) => setSelected(event.target.checked ? selectableIds : [])}
              />
              Select all on this page
            </label>
            {selectedIds.length > 0 && (
              <>
                <span aria-live="polite">{selectedIds.length} selected</span>
                {canMove && <button type="button" disabled={loading || batchBusy} className="rounded-lg border px-3 py-2 text-teal-800 disabled:opacity-40" onClick={() => openBatch("move")}>Move selected</button>}
                {user.role === "admin" && <button type="button" disabled={loading || batchBusy} className="rounded-lg border px-3 py-2 text-red-700 disabled:opacity-40" onClick={() => openBatch("delete")}>Delete selected</button>}
              </>
            )}
          </div>
        )}
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-busy={loading}
        >
          {listing.data.map((row) => (
            <article key={row.id} className={`rounded-2xl border p-5 ${selectedIds.includes(row.id) ? "border-teal-600 bg-teal-50" : "bg-white"}`}>
              <div className="flex items-center gap-3">
                {canSelect && !row.deletedAt && <input
                  type="checkbox"
                  aria-label={`Select ${row.name}`}
                  checked={selectedIds.includes(row.id)}
                  disabled={loading || batchBusy}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((current) => checked ? [...current, row.id] : current.filter((id) => id !== row.id));
                  }}
                />}
                <h3 className="min-w-0 flex-1 break-words font-semibold">{row.name}</h3>
                {canMove && !row.deletedAt && (
                  <span
                    className="cursor-grab rounded-lg p-2 text-slate-500 hover:bg-teal-100 active:cursor-grabbing"
                    title="Drag to a folder"
                    aria-hidden="true"
                    draggable={!loading && !batchBusy}
                    onDragStart={(event) => {
                      draggedChecklist.current = row.id;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", row.id);
                    }}
                    onDragEnd={endDrag}
                  >
                    <GripVertical size={18} />
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs">
                {row.status === "completed" ? "Finished" : "In progress"} ·{" "}
                {row.completed} completed · {row.skipped} skipped · {row.total}{" "}
                total{row.deletedAt ? " · deleted" : ""}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={
                    row.skipped ? "h-full bg-amber-500" : "h-full bg-teal-600"
                  }
                  style={{
                    width: `${row.total ? ((row.completed + row.skipped) / row.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Created {new Date(row.createdAt).toLocaleString()}
              </p>
              <a
                className="mt-4 inline-block rounded-xl border px-3 py-2 text-sm text-teal-800"
                href={checklistPath(organization.id, row.id)}
              >
                {row.deletedAt ? "View recovery" : "Open checklist"}
              </a>
            </article>
          ))}
        </div>
        {!listing.data.length && (
          <p className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">
            {loading ? "Loading checklists…" : "No matching checklists."}
          </p>
        )}
        <div className="flex items-center justify-between text-sm">
          <span>
            {listing.total} checklist(s) · page {listing.page}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
              disabled={listing.page <= 1 || loading || batchBusy}
              onClick={() => filter({ page: listing.page - 1 })}
            >
              Previous
            </button>
            <button
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
              disabled={
                listing.page * listing.pageSize >= listing.total || loading || batchBusy
              }
              onClick={() => filter({ page: listing.page + 1 })}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {batch === "delete" && (
        <ChecklistDeleteDialog
          count={selectedIds.length}
          busy={batchBusy}
          error={batchError}
          onClose={() => { if (!batchBusy) setBatch(null); }}
          onConfirm={() => void submitBatch(selectedIds, { action: "delete" })}
        />
      )}
      {batch === "move" && (
        <Modal title={selectedIds.length === 1 ? "Move checklist" : `Move ${selectedIds.length} checklists`} onClose={() => { if (!batchBusy) setBatch(null); }}>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            if (moveFolderId) void submitBatch(selectedIds, { action: "move", folderId: moveFolderId });
          }}>
            <label className="block text-sm">
              Destination folder
              <select required disabled={batchBusy} value={moveFolderId} className="mt-2 w-full rounded-xl border p-3"
                onChange={(event) => setMoveFolderId(event.target.value)}>
                <option value="">Choose a folder</option>
                {movableFolders.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            {batchError && <p role="alert" className="text-sm text-red-700">{batchError}</p>}
            <button disabled={batchBusy || !moveFolderId} className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40">
              {batchBusy ? "Moving…" : selectedIds.length === 1 ? "Move checklist" : "Move checklists"}
            </button>
          </form>
        </Modal>
      )}
      {editingFolder && <TextPrompt
        title={editingFolder === "new" ? "New folder" : "Rename folder"}
        label="Folder name"
        maxLength={100}
        errorMessage={folderError}
        initialValue={editingFolder === "new" ? "" : editingFolder.name}
        onClose={() => setEditingFolder(null)}
        onSubmit={async (name) => {
          const suffix = editingFolder === "new" ? "" : `/${editingFolder.id}`;
          setFolderError("");
          try {
            const { data } = await api(`${apiPath}/folders${suffix}`, editingFolder === "new" ? "POST" : "PATCH", { name });
            setFolderRows((current) => [...current.filter((entry) => entry.id !== data.id), data]);
            setEditingFolder(null);
          } catch (failure) {
            setFolderError((failure as Error).message);
          }
        }}
      />}
      {creating && (
        <Modal title="New checklist" onClose={() => setCreating(false)}>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !destinationId) return;
              setBusy(true);
              setCreateError("");
              try {
                const result = await api(`${apiPath}/checklists`, "POST", {
                  templateId,
                  folderId: destinationId,
                  name,
                  creationKey,
                });
                router.push(checklistPath(organization.id, result.data.id));
              } catch (failure) {
                setCreateError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {folder ? <p className="text-sm">Folder <strong>{folder.name}</strong></p> : <label className="block text-sm">
              Folder
              <select
                aria-label="Checklist folder"
                required
                disabled={busy}
                className="mt-2 w-full rounded-xl border p-3"
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                <option value="">Choose a folder</option>
                {folderRows.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>}
            <label className="block text-sm">
              Organization template
              <select
                aria-label="Organization template"
                required
                disabled={busy}
                className="mt-2 w-full rounded-xl border p-3"
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                  setName(
                    choices.find(
                      (template) => template.id === event.target.value,
                    )?.name ?? "",
                  );
                }}
              >
                <option value="">Choose a template</option>
                {choices.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            {!choices.length && (
              <p className="text-sm text-amber-800">
                This organization has no linked templates yet.
              </p>
            )}
            <label className="block text-sm">
              Checklist name
              <input
                required
                maxLength={160}
                disabled={busy}
                className="mt-2 w-full rounded-xl border p-3"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="text-xs text-slate-500">
              Current instructions, variables, and repeated steps will be
              frozen. Template edits afterward will not change this checklist.
            </p>
            {createError && (
              <p role="alert" className="text-sm text-red-700">
                {createError}
              </p>
            )}
            <button
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={busy || !destinationId || !templateId || !name.trim()}
            >
              {busy ? "Creating…" : "Create checklist"}
            </button>
          </form>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
