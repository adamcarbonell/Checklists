"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ChecklistSummary,
  TemplateSummary,
  WorkspaceUser,
} from "@/lib/workspace-types";
import { WorkspaceShell, Modal, api } from "./workspace-ui";
type Listing = {
  data: ChecklistSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export function ChecklistBoard({
  initial,
  organizations,
  templates,
  user,
  databaseAvailable = true,
}: {
  initial: Listing;
  organizations: { id: string; name: string }[];
  templates: TemplateSummary[];
  user: WorkspaceUser;
  databaseAvailable?: boolean;
}) {
  const router = useRouter();
  const [listing, setListing] = useState(initial),
    [filters, setFilters] = useState({
      organizationId: "",
      status: "active",
      search: "",
      page: 1,
      includeDeleted: false,
    }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false),
    [orgId, setOrgId] = useState(organizations[0]?.id ?? ""),
    [templateId, setTemplateId] = useState(""),
    [name, setName] = useState(""),
    [creationKey, setCreationKey] = useState(""),
    [busy, setBusy] = useState(false);
  const choices = templates.filter(
    (template) => template.organizationId === orgId,
  );
  useEffect(() => {
    if (!databaseAvailable) return;
    let canceled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(filters.page) });
      if (filters.organizationId)
        params.set("organizationId", filters.organizationId);
      if (filters.status) params.set("status", filters.status);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.includeDeleted) params.set("includeDeleted", "true");
      void api("/api/checklists?" + params)
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
  }, [filters, databaseAvailable]);
  function filter(change: Partial<typeof filters>) {
    setLoading(true);
    setFilters((current) => ({
      ...current,
      ...change,
      page: change.page ?? 1,
    }));
  }
  function newChecklist() {
    const first = templates.find(
      (template) => template.organizationId === orgId,
    );
    setTemplateId(first?.id ?? "");
    setName(first?.name ?? "");
    setCreationKey(crypto.randomUUID());
    setError("");
    setCreating(true);
  }
  return (
    <WorkspaceShell user={user} active="checklists">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold">Checklists</h1>
          <p className="mt-2 text-sm text-slate-500">
            Shared work, with frozen instructions and an auditable history.
          </p>
        </div>
        <button
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={!databaseAvailable || !templates.length}
          onClick={newChecklist}
        >
          New checklist
        </button>
      </header>
      <div className="space-y-5 p-6">
        {!databaseAvailable && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm">
            Database unavailable in this local environment. No sample
            organizations, checklists, or validation results have been
            substituted.
          </p>
        )}
        {!templates.length && databaseAvailable && (
          <p className="rounded-xl border bg-white p-5 text-sm">
            An editor must create a global template and link it inside an
            organization before a checklist can be started.{" "}
            <Link href="/organizations" className="text-teal-800 underline">
              Open Organizations
            </Link>
          </p>
        )}
        {error && !creating && (
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
            placeholder="Search checklist name or client"
            onChange={(event) => filter({ search: event.target.value })}
          />
          <select
            aria-label="Filter organization"
            className="rounded-xl border bg-white p-3 text-sm"
            value={filters.organizationId}
            onChange={(event) => filter({ organizationId: event.target.value })}
          >
            <option value="">All organizations</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter status"
            className="rounded-xl border bg-white p-3 text-sm"
            value={filters.status}
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
                onChange={(event) =>
                  filter({ includeDeleted: event.target.checked })
                }
              />
              Include deleted
            </label>
          )}
        </div>
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-busy={loading}
        >
          {listing.data.map((row) => (
            <article key={row.id} className="rounded-2xl border bg-white p-5">
              <p className="text-xs text-slate-500">{row.organizationName}</p>
              <h2 className="mt-2 font-semibold">{row.name}</h2>
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
                href={`/checklists/${row.id}`}
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
              disabled={listing.page <= 1 || loading}
              onClick={() => filter({ page: listing.page - 1 })}
            >
              Previous
            </button>
            <button
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
              disabled={
                listing.page * listing.pageSize >= listing.total || loading
              }
              onClick={() => filter({ page: listing.page + 1 })}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {creating && (
        <Modal title="New checklist" onClose={() => setCreating(false)}>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const result = await api("/api/checklists", "POST", {
                  templateId,
                  name,
                  creationKey,
                });
                router.push(`/checklists/${result.data.id}`);
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block text-sm">
              Organization
              <select
                aria-label="Checklist organization"
                required
                disabled={busy}
                className="mt-2 w-full rounded-xl border p-3"
                value={orgId}
                onChange={(event) => {
                  setOrgId(event.target.value);
                  const template = templates.find(
                    (entry) => entry.organizationId === event.target.value,
                  );
                  setTemplateId(template?.id ?? "");
                  setName(template?.name ?? "");
                }}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
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
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={busy || !templateId || !name.trim()}
            >
              {busy ? "Creating…" : "Create checklist"}
            </button>
          </form>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
