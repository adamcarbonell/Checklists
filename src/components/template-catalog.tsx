"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplateSummary, WorkspaceUser } from "@/lib/workspace-types";
import { WorkspaceShell, Modal, HistoryDialog, api } from "./workspace-ui";
export function TemplateCatalog({
  initial,
  globals,
  user,
  organization,
}: {
  initial: TemplateSummary[];
  globals: TemplateSummary[];
  user: WorkspaceUser;
  organization?: { id: string; name: string };
}) {
  const router = useRouter(),
    canEdit = user.role !== "viewer";
  const [rows, setRows] = useState(initial),
    [query, setQuery] = useState(""),
    [deleted, setDeleted] = useState(false),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [parentId, setParentId] = useState(globals[0]?.id ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<string | null>(null);
  const title = organization ? organization.name : "Global templates",
    scope = organization ? "organization" : "global";
  async function refresh() {
    const result = await api(
      `/api/templates?scope=${scope}&includeDeleted=true${organization ? `&organizationId=${organization.id}` : ""}`,
    );
    setRows(result.data);
  }
  return (
    <WorkspaceShell
      user={user}
      active={organization ? "organizations" : "templates"}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-5">
        <div>
          <p className="text-xs text-slate-500">
            {organization
              ? "Organizations / Templates"
              : "Workspace / Global templates"}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {organization
              ? "Link a global template and add steps that belong only to this client’s template."
              : "Maintain standard checklists centrally. Linked organization templates inherit your changes."}
          </p>
        </div>
        {canEdit && (
          <button
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            disabled={!!organization && !globals.length}
            onClick={() => {
              setName(
                organization
                  ? (globals.find((template) => template.id === parentId)
                      ?.name ?? "")
                  : "",
              );
              setError("");
              setCreating(true);
            }}
          >
            {organization ? "New organization template" : "New global template"}
          </button>
        )}
      </header>
      <div className="space-y-5 p-6">
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {organization && !globals.length && (
          <p className="rounded-xl border bg-white p-5 text-sm">
            Create an active global template before linking an organization
            template.{" "}
            <a className="text-teal-800 underline" href="/global-templates">
              Global templates
            </a>
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          <input
            aria-label="Search templates"
            className="min-w-60 flex-1 rounded-xl border bg-white p-3 text-sm"
            placeholder="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deleted}
              onChange={(event) => setDeleted(event.target.checked)}
            />
            Show deleted templates
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows
            .filter(
              (row) =>
                !!row.deletedAt === deleted &&
                row.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((row) => (
              <article key={row.id} className="rounded-2xl border bg-white p-5">
                <h2 className="font-semibold">{row.name}</h2>
                <p className="mt-2 text-xs text-slate-500">
                  {organization
                    ? `Linked to ${globals.find((parent) => parent.id === row.globalTemplateId)?.name ?? "unavailable global template"}`
                    : "Standard steps owned by this template"}{" "}
                  · v{row.version}
                </p>
                {row.deletedAt ? (
                  <button
                    className="mt-4 text-sm text-teal-800 underline"
                    onClick={() => setHistory(row.id)}
                  >
                    View recovery history
                  </button>
                ) : (
                  <a
                    className="mt-4 inline-block rounded-xl border px-3 py-2 text-sm text-teal-800"
                    href={`/templates/${row.id}`}
                  >
                    Open template
                  </a>
                )}
              </article>
            ))}
        </div>
        {!rows.some(
          (row) =>
            !!row.deletedAt === deleted &&
            row.name.toLowerCase().includes(query.toLowerCase()),
        ) && (
          <p className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">
            No {deleted ? "deleted" : "matching active"} templates.
          </p>
        )}
      </div>
      {creating && (
        <Modal
          title={
            organization ? "New organization template" : "New global template"
          }
          onClose={() => setCreating(false)}
        >
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const result = await api("/api/templates", "POST", {
                  scope,
                  name,
                  ...(organization
                    ? {
                        organizationId: organization.id,
                        globalTemplateId: parentId,
                      }
                    : {}),
                });
                router.push(`/templates/${result.data.id}`);
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {organization && (
              <label className="block text-sm">
                Global template
                <select
                  required
                  aria-label="Global template"
                  className="mt-2 w-full rounded-xl border p-3"
                  value={parentId}
                  disabled={busy}
                  onChange={(event) => {
                    setParentId(event.target.value);
                    setName(
                      globals.find(
                        (template) => template.id === event.target.value,
                      )?.name ?? "",
                    );
                  }}
                >
                  {globals.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm">
              Template name
              <input
                required
                maxLength={160}
                className="mt-2 w-full rounded-xl border p-3"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              disabled={busy || !name.trim() || (!!organization && !parentId)}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create template"}
            </button>
          </form>
        </Modal>
      )}
      {history && (
        <HistoryDialog
          entities={[{ type: "template", id: history }]}
          canEdit={canEdit}
          onClose={() => setHistory(null)}
          onRestored={refresh}
        />
      )}
    </WorkspaceShell>
  );
}
export function OrganizationDirectory({
  organizations,
  user,
}: {
  organizations: { id: string; name: string }[];
  user: WorkspaceUser;
}) {
  const [query, setQuery] = useState("");
  return (
    <WorkspaceShell user={user} active="organizations">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold">Organizations</h1>
          <p className="mt-2 text-sm text-slate-500">
            Manage each client’s linked templates and local instructions.
          </p>
        </div>
        {user.role === "admin" && (
          <a
            href="/admin/organizations"
            className="rounded-xl border px-3 py-2 text-sm"
          >
            Manage IT Glue organizations
          </a>
        )}
      </header>
      <div className="p-6">
        <input
          className="w-full rounded-xl border bg-white p-3 text-sm"
          aria-label="Search organizations"
          placeholder="Search enabled organizations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {organizations
            .filter((org) =>
              org.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((org) => (
              <a
                key={org.id}
                className="rounded-2xl border bg-white p-5"
                href={`/organizations/${org.id}`}
              >
                <h2 className="font-semibold">{org.name}</h2>
                <p className="mt-2 text-sm text-teal-700">
                  Open organization templates →
                </p>
              </a>
            ))}
        </div>
        {!organizations.length && (
          <p className="mt-6 rounded-xl border bg-white p-8 text-sm text-slate-500">
            No enabled organizations. An administrator can enable them through
            the IT Glue management page.
          </p>
        )}
      </div>
    </WorkspaceShell>
  );
}
